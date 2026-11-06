/**
 * Real on-chain smoke test (web3.md section 11). Run with the demo merchants up:
 *   npm run dev -w apps/demo-merchants   (in another terminal)
 *   npm run smoke
 *
 * 1. balances   2. real x402 payment to hbar-price   3. upfront + 500 (dodgy-diner)
 * 4. 3-party refund tx from the vault   5. HCS message
 */
import { Client, PrivateKey, TokenId, TopicMessageSubmitTransaction, TransferTransaction } from "@hiero-ledger/sdk";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { hashscanTx } from "@app/shared";

const e = process.env;
const need = (k: string) => { const v = e[k]; if (!v) throw new Error(`Missing ${k} in .env`); return v; };
const MIRROR = e.MIRROR_URL || "https://testnet.mirrornode.hedera.com";
const USDC = e.USDC_TOKEN_ID || "0.0.429274";
const MERCHANTS = e.MERCHANTS_URL || "http://localhost:4100";
const only = process.argv[2]; // optional step filter: pay | refund | hcs

const parseKey = (k: string) => { try { return PrivateKey.fromStringDer(k); } catch { try { return PrivateKey.fromStringECDSA(k); } catch { return PrivateKey.fromStringED25519(k); } } };
const ok = (s: string) => console.log(`  ✓ ${s}`);
const fail = (s: string) => { console.log(`  ✗ ${s}`); process.exitCode = 1; };

async function usdcBalance(id: string) {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${id}/tokens?token.id=${USDC}`);
  const j = (await r.json()) as { tokens: { balance: number }[] };
  return j.tokens?.[0]?.balance ?? 0;
}

console.log("1. balances");
const accounts = { gateway: need("GATEWAY_ACCOUNT_ID"), vault: need("VAULT_ACCOUNT_ID"), agent: need("AGENT_ACCOUNT_ID"), merchant: need("MERCHANT_ACCOUNT_ID") };
const before: Record<string, number> = {};
for (const [k, id] of Object.entries(accounts)) { before[k] = await usdcBalance(id); console.log(`  ${k.padEnd(9)} ${id.padEnd(12)} ${(before[k] / 1e6).toFixed(6)} USDC`); }
if (before.agent < 200_000) fail("agent needs at least 0.2 USDC");
if (before.gateway < 200_000) fail("gateway needs at least 0.2 USDC");

if (!only || only === "pay") {
  console.log("\n2. real x402 payment: agent -> demo merchant hbar-price");
  const signer = createClientHederaSigner(accounts.agent, parseKey(need("AGENT_PRIVATE_KEY")), { network: "hedera:testnet" });
  const client = x402Client.fromConfig({ schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }], spendControls: { maxAmountPerPayment: "$5" } });
  const payFetch = wrapFetchWithPayment(fetch, client);
  try {
    const res = await payFetch(`${MERCHANTS}/m/hbar-price`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(90_000) });
    const header = res.headers.get("payment-response");
    const settle = header ? decodePaymentResponseHeader(header) : null;
    const body = await res.text();
    if (res.status === 200 && settle?.success) ok(`status 200, settled ${settle.transaction}\n    ${hashscanTx(settle.transaction)}\n    body: ${body.slice(0, 120)}`);
    else fail(`status ${res.status} settle=${JSON.stringify(settle)} body=${body.slice(0, 200)}`);
  } catch (err) { fail(`payment threw: ${String((err as Error).message ?? err)}`); }

  console.log("\n3. upfront flow with a failing handler: dodgy-diner");
  try {
    const res = await payFetch(`${MERCHANTS}/m/dodgy-diner`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(90_000) });
    const header = res.headers.get("payment-response");
    const settle = header ? decodePaymentResponseHeader(header) : null;
    if (res.status === 500 && settle?.success) ok(`status 500 but money moved: ${settle.transaction}\n    ${hashscanTx(settle.transaction)}  (this is the gap the gateway closes)`);
    else fail(`status ${res.status} settle=${JSON.stringify(settle)}`);
  } catch (err) { fail(`payment threw: ${String((err as Error).message ?? err)}`); }
}

const gatewayKey = parseKey(need("GATEWAY_PRIVATE_KEY"));
const hedera = Client.forTestnet().setOperator(accounts.gateway, gatewayKey);

if (!only || only === "refund") {
  console.log("\n4. 3-party refund transaction from the vault (0.001 USDC + 0.0002 penalty)");
  const vaultBal = await usdcBalance(accounts.vault);
  if (vaultBal < 1200) fail("vault needs at least 0.0012 USDC for this step");
  else {
    try {
      const usdc = TokenId.fromString(USDC);
      const tx = new TransferTransaction()
        .addTokenTransfer(usdc, accounts.vault, -1200)
        .addTokenTransfer(usdc, accounts.agent, 1000)
        .addTokenTransfer(usdc, accounts.gateway, 200)
        .setTransactionMemo("refund:smoke-test")
        .freezeWith(hedera);
      await tx.sign(parseKey(need("VAULT_PRIVATE_KEY")));
      const resp = await tx.execute(hedera);
      const receipt = await resp.getReceipt(hedera);
      ok(`${receipt.status.toString()} ${resp.transactionId.toString()}\n    ${hashscanTx(resp.transactionId.toString())}`);
    } catch (err) { fail(`refund threw: ${String((err as Error).message ?? err)}`); }
  }
}

if (!only || only === "hcs") {
  console.log("\n5. HCS message");
  if (!e.HCS_TOPIC_ID) fail("HCS_TOPIC_ID not set, run `npm run setup` first");
  else {
    try {
      const tx = await new TopicMessageSubmitTransaction().setTopicId(e.HCS_TOPIC_ID).setMessage(JSON.stringify({ v: 1, smoke: true, ts: Date.now() })).execute(hedera);
      const receipt = await tx.getReceipt(hedera);
      ok(`sequence ${receipt.topicSequenceNumber?.toString()}  https://hashscan.io/testnet/topic/${e.HCS_TOPIC_ID}`);
    } catch (err) { fail(`HCS threw: ${String((err as Error).message ?? err)}`); }
  }
}

hedera.close();
console.log(process.exitCode ? "\nSome steps failed." : "\nAll steps passed.");
