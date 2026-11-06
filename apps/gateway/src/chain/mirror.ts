import { toMirrorTxId } from "@app/shared";
import { env } from "../env.ts";

type MirrorTx = {
  result: string;
  memo_base64?: string;
  consensus_timestamp?: string;
  transaction_id?: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
};

async function mirrorGet(path: string): Promise<Response> {
  return fetch(`${env.mirrorUrl}/api/v1${path}`, { signal: AbortSignal.timeout(10_000) });
}

export class DepositError extends Error {
  constructor(public code: "not_found_yet" | "not_successful" | "wrong_memo" | "no_vault_credit") {
    super(code);
  }
}

export async function verifyDeposit(txIdRaw: string, merchantId: string) {
  const id = txIdRaw.includes("@") ? toMirrorTxId(txIdRaw) : txIdRaw.trim();
  const res = await mirrorGet(`/transactions/${id}`);
  if (!res.ok) throw new DepositError("not_found_yet");

  const body = (await res.json()) as { transactions: MirrorTx[] };
  const tx = body.transactions.find((t) => t.result === "SUCCESS");
  if (!tx) throw new DepositError("not_successful");

  const memo = Buffer.from(tx.memo_base64 ?? "", "base64").toString();
  if (memo !== `bond:${merchantId}`) throw new DepositError("wrong_memo");

  const credit = tx.token_transfers?.find(
    (t) => t.token_id === env.usdc && t.account === env.vaultId && Number(t.amount) > 0,
  );
  if (!credit) throw new DepositError("no_vault_credit");

  return { amount: Number(credit.amount), txId: id };
}

/** After a timeout: did the gateway's USDC actually reach the merchant? */
export async function gatewayPaidMerchant(payout: string, sinceSeconds: number, price: number): Promise<string | null> {
  const url = `/transactions?account.id=${env.gatewayId}&timestamp=gte:${sinceSeconds}` +
    `&transactiontype=cryptotransfer&order=desc&limit=25`;
  const res = await mirrorGet(url);
  if (!res.ok) return null;
  const { transactions } = (await res.json()) as { transactions: MirrorTx[] };
  const hit = transactions.find((t) =>
    t.result === "SUCCESS" &&
    t.token_transfers?.some((x) => x.account === payout && x.token_id === env.usdc && Number(x.amount) === price));
  return hit?.transaction_id ?? null;
}

export async function txExists(txId: string): Promise<boolean> {
  const res = await mirrorGet(`/transactions/${toMirrorTxId(txId)}`);
  if (!res.ok) return false;
  const body = (await res.json()) as { transactions: MirrorTx[] };
  return body.transactions.some((t) => t.result === "SUCCESS");
}

/**
 * Did a Scheduled Transaction execute? Returns the executed transfer's transaction id (the agent's
 * settlement for a subscription run), null while it is still waiting, "expired" once the network
 * dropped it unexecuted (e.g. the wallet could not pay), or throws when the mirror node is unreachable.
 */
export async function scheduleExecution(scheduleId: string): Promise<string | null | "expired"> {
  const res = await mirrorGet(`/schedules/${scheduleId}`);
  if (!res.ok) throw new Error(`mirror schedule ${res.status}`);
  const s = (await res.json()) as { executed_timestamp: string | null; expiration_time: string | null; deleted: boolean };
  if (!s.executed_timestamp) {
    // 10 minutes past expiry with no execution: the network will never run it.
    if (s.deleted || (s.expiration_time && Number(s.expiration_time) + 600 < Date.now() / 1000)) return "expired";
    return null;
  }
  const txs = await mirrorGet(`/transactions?timestamp=${s.executed_timestamp}`);
  if (!txs.ok) throw new Error(`mirror transactions ${txs.status}`);
  const { transactions } = (await txs.json()) as { transactions: (MirrorTx & { scheduled?: boolean })[] };
  const hit = transactions.find((t) => t.scheduled && t.result === "SUCCESS");
  if (!hit?.transaction_id) return "expired"; // executed but the inner transfer failed (e.g. insufficient USDC)
  return hit.transaction_id;
}

export async function usdcBalance(accountId: string): Promise<number | null> {
  const res = await mirrorGet(`/accounts/${accountId}/tokens?token.id=${env.usdc}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { tokens: { balance: number }[] };
  return body.tokens[0]?.balance ?? 0;
}
