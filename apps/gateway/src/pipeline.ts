import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, type ClientHederaSigner } from "@x402/hedera";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import type { Merchant, Payment } from "./db/schema.ts";
import { env } from "./env.ts";
import { newId, sha256 } from "./ids.ts";
import { runChecks, type CallResult, type Verdict } from "./checks.ts";
import { lockFor, outcomeFor, totalFor, type FaultCase } from "./money.ts";
import type { PolicyOk } from "./policy.ts";
import { lockBond, unlockBond } from "./policy.ts";
import { requestStore } from "./x402.ts";
import { enqueue, recordOutcome } from "./worker.ts";

const { payments, approvals } = schema;
const MAX_BODY = 1_000_000;

export type CallMerchant = (merchant: Merchant, body: string) => Promise<CallResult>;
export type PaidCheck = (merchant: Merchant, sinceSeconds: number) => Promise<string | null>;

export interface PipelineDeps {
  db: Db;
  callMerchant: CallMerchant;
  /** After a timeout: did our USDC reach the merchant? Returns the tx id when it did. */
  gatewayPaidMerchant: PaidCheck;
  /** Wait before the chain check (6s in production, 0 in tests). */
  chainCheckDelayMs: number;
}

/* ---------------------------------------------------------------------------------- */
/* Merchant leg                                                                       */
/* ---------------------------------------------------------------------------------- */

let gatewaySigner: ClientHederaSigner | null = null;
async function getGatewaySigner(): Promise<ClientHederaSigner> {
  if (!gatewaySigner) {
    const { gatewayKey } = await import("./chain/hedera.ts");
    gatewaySigner = createClientHederaSigner(env.gatewayId, gatewayKey, { network: env.network });
  }
  return gatewaySigner;
}

async function readLimited(res: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function classifyCallError(err: unknown, latencyMs: number): CallResult {
  const e = err as { name?: string; message?: string; cause?: { name?: string; code?: string } };
  const msg = e?.message ?? String(err);
  if (e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError" || /timeout/i.test(msg)) {
    return { kind: "error", reason: "timeout", detail: msg, latencyMs, merchantPaid: null, merchantTxId: null };
  }
  if (/filtered out by policies|no payment requirements|No matching/i.test(msg)) {
    return { kind: "error", reason: "price_mismatch", detail: msg, latencyMs, merchantPaid: false, merchantTxId: null };
  }
  if (/INSUFFICIENT|TOKEN_NOT_ASSOCIATED|sign|signer|payload/i.test(msg)) {
    return { kind: "error", reason: "gateway_error", detail: msg, latencyMs, merchantPaid: false, merchantTxId: null };
  }
  return { kind: "error", reason: "network_error", detail: msg, latencyMs, merchantPaid: null, merchantTxId: null };
}

/** Pays the merchant over x402 from the gateway account and calls its endpoint. */
export const callMerchantLive: CallMerchant = async (merchant, body) => {
  const started = Date.now();
  try {
    const signer = await getGatewaySigner();
    const client = x402Client.fromConfig({
      schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
      policies: [
        (_v, reqs) => reqs.filter((r) =>
          BigInt(r.amount) <= BigInt(merchant.price) &&
          r.asset === env.usdc &&
          r.payTo === merchant.payoutAccountId),
      ],
      spendControls: { maxAmountPerPayment: "$5" },
    });
    const payFetch = wrapFetchWithPayment(fetch, client);
    const signal = AbortSignal.timeout(merchant.timeoutMs);
    const res = await payFetch(merchant.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      redirect: "error",
      signal,
    });
    const text = await readLimited(res, MAX_BODY, signal);
    const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    let settlement: { success?: boolean; transaction?: string } | null = null;
    if (header) { try { settlement = decodePaymentResponseHeader(header); } catch { settlement = null; } }
    return {
      kind: "response",
      status: res.status,
      text,
      latencyMs: Date.now() - started,
      merchantPaid: settlement?.success === true,
      merchantTxId: settlement?.transaction ?? null,
    };
  } catch (err) {
    return classifyCallError(err, Date.now() - started);
  }
};

/* ---------------------------------------------------------------------------------- */
/* Handler                                                                            */
/* ---------------------------------------------------------------------------------- */

const receiptUrl = (id: string) => `${env.webOrigin}/receipts/${id}`;

export function makeCallHandler(deps: PipelineDeps) {
  const { db } = deps;

  return async function callHandler(c: Context) {
    const settlement = requestStore.getStore()?.settlement;
    const policy = c.get("policy") as PolicyOk | undefined;
    if (!policy) return c.json({ error: "policy_missing" }, 500);
    if (!settlement?.success || !settlement.transaction) {
      return c.json({ error: "settlement_missing" }, 500);
    }
    const { agent, merchant, fee } = policy;

    // The UNIQUE constraint on agent_tx_id rejects any reuse of a settlement.
    const paymentId = newId("pay");
    try {
      db.insert(payments).values({
        id: paymentId, agentId: agent.id, merchantId: merchant.id, price: merchant.price, fee,
        status: "calling", agentTxId: settlement.transaction,
      }).run();
    } catch {
      return c.json({ error: "settlement_reused" }, 409);
    }
    if (policy.approvalId) {
      db.update(approvals).set({ status: "used" }).where(eq(approvals.id, policy.approvalId)).run();
    }

    // Payment came from an account that is not this agent: refund in full, no merchant call.
    if (settlement.payer && settlement.payer !== agent.hederaAccountId) {
      return finish(c, deps, paymentId, merchant, null, { ok: false, reason: "payer_mismatch", detail: `payer ${settlement.payer}` }, "C", false);
    }

    const lock = lockFor(merchant.price);
    if (!lockBond(db, merchant.id, lock)) {
      return finish(c, deps, paymentId, merchant, null, { ok: false, reason: "bond_lock_failed" }, "C", false);
    }

    const body = await c.req.text();
    const result = await deps.callMerchant(merchant, body);
    const verdict = runChecks(result, merchant);

    if (verdict.ok) return finish(c, deps, paymentId, merchant, result, verdict, "delivered", true);

    // Our own failure to pay is never the merchant's fault.
    if (result.kind === "error" && result.reason === "gateway_error") {
      return finish(c, deps, paymentId, merchant, result, verdict, "C", true);
    }

    let paid = result.merchantPaid;
    if (paid === null) {
      // Timeout or network error: the merchant may still have settled. Ask the chain.
      if (deps.chainCheckDelayMs > 0) await new Promise((r) => setTimeout(r, deps.chainCheckDelayMs));
      const since = Math.floor((Date.now() - result.latencyMs) / 1000) - 120;
      const txId = await deps.gatewayPaidMerchant(merchant, since);
      paid = txId !== null;
      if (txId && result.kind === "error") result.merchantTxId = txId;
    }
    return finish(c, deps, paymentId, merchant, result, verdict, paid ? "A" : "B", true);
  };
}

function finish(
  c: Context,
  deps: PipelineDeps,
  paymentId: string,
  merchant: Merchant,
  result: CallResult | null,
  verdict: Verdict,
  kind: "delivered" | FaultCase,
  locked: boolean,
) {
  const { db } = deps;
  const out = outcomeFor(kind, merchant.price);
  const now = Date.now();
  const text = result?.kind === "response" ? result.text : null;
  const common: Partial<Payment> = {
    httpStatus: result?.kind === "response" ? result.status : null,
    latencyMs: result?.latencyMs ?? null,
    responseHash: text !== null ? sha256(text) : null,
    merchantTxId: result?.merchantTxId ?? null,
    merchantPaid: result ? result.merchantPaid === true : false,
  };

  db.transaction((tx) => {
    if (kind === "delivered") {
      tx.update(payments).set({ ...common, status: "delivered", merchantPaid: true, finishedAt: now }).where(eq(payments.id, paymentId)).run();
    } else {
      tx.update(payments).set({
        ...common,
        status: "refund_pending",
        faultCase: kind,
        failureReason: verdict.ok ? null : verdict.reason,
        failureDetail: verdict.ok ? null : (verdict.detail ?? null),
        merchantPaid: kind === "A",
      }).where(eq(payments.id, paymentId)).run();
    }
    // Case A keeps the lock until the refund slashes the bond.
    if (locked && kind !== "A") unlockBond(tx as unknown as Db, merchant.id, lockFor(merchant.price));
  });

  recordOutcome(db, merchant.id, out.failure, out.countsForReputation);
  if (kind === "delivered") enqueue(db, "hcs", { paymentId });
  else enqueue(db, "refund", { paymentId });

  if (kind === "delivered") {
    let data: unknown = text;
    try { data = JSON.parse(text ?? ""); } catch { /* keep text */ }
    return c.json({ outcome: "delivered", paymentId, data, receiptUrl: receiptUrl(paymentId) }, 200);
  }
  return c.json({
    outcome: "refund_pending",
    paymentId,
    reason: verdict.ok ? null : verdict.reason,
    detail: verdict.ok ? null : verdict.detail,
    faultCase: kind,
    refundAmount: String(out.refundToAgent),
    agentPaid: String(totalFor(merchant.price)),
    statusUrl: `${env.publicUrl}/v1/payments/${paymentId}`,
    receiptUrl: receiptUrl(paymentId),
  }, 502);
}
