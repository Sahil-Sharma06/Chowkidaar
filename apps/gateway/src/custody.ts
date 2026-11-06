/**
 * Custodial agent wallets for the playground. The gateway creates a real Hedera account per agent,
 * keeps its key sealed in the database, and pays over x402 exactly like an external agent would:
 * a genuine HTTP round trip through /v1/call, so policy, settlement and refunds are the same path.
 *
 * ponytail: sealed with a key derived from JWT_SECRET; move to a KMS before holding anything but testnet funds.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AccountCreateTransaction, Hbar, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey as XPrivateKey } from "@x402/hedera";
import { env } from "./env.ts";
import { client, USDC } from "./chain/hedera.ts";

const KEY = createHash("sha256").update(env.jwtSecret).digest();

export type Custody = { walletKey: string; apiKey: string };

export function seal(data: Custody): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function unseal(s: string): Custody {
  const b = Buffer.from(s, "base64");
  const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString()) as Custody;
}

/** New ECDSA account funded with 1 HBAR for fees, unlimited auto-association so USDC can land without a step. */
export async function createAgentWallet(label: string): Promise<{ accountId: string; walletKey: string }> {
  const key = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key)
    .setInitialBalance(new Hbar(1))
    .setMaxAutomaticTokenAssociations(-1)
    .setAccountMemo(`chowkidaar agent ${label}`.slice(0, 100))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return { accountId: receipt.accountId!.toString(), walletKey: key.toStringDer() };
}

/** Demo mode only: the gateway tops up an agent wallet with testnet USDC. */
export async function fundAgent(to: string, amount: number) {
  const tx = await new TransferTransaction()
    .addTokenTransfer(USDC, env.gatewayId, -amount)
    .addTokenTransfer(USDC, to, amount)
    .setTransactionMemo("chowkidaar demo funding")
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return { txId: tx.transactionId.toString(), status: receipt.status.toString() };
}

export async function payAsAgent(opts: { accountId: string; walletKey: string; apiKey: string; slug: string; body: unknown; approvalId?: string }) {
  const signer = createClientHederaSigner(opts.accountId, XPrivateKey.fromStringDer(opts.walletKey), { network: env.network });
  const x = x402Client.fromConfig({
    schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
    spendControls: { maxAmountPerPayment: "$5" },
  });
  const pay = wrapFetchWithPayment(fetch, x);
  const res = await pay(`${env.publicUrl}/v1/call/${opts.slug}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": opts.apiKey, ...(opts.approvalId ? { "x-approval-id": opts.approvalId } : {}) },
    body: JSON.stringify(opts.body ?? {}),
    signal: AbortSignal.timeout(90_000),
  });
  const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let agentTx: string | null = null;
  if (header) { try { agentTx = decodePaymentResponseHeader(header).transaction ?? null; } catch { /* no settlement header */ } }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body, agentTx };
}
