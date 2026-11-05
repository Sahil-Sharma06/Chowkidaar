import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import type { Job } from "./db/schema.ts";
import { env, hasArkiv, hasHcs } from "./env.ts";
import { newId } from "./ids.ts";
import { outcomeFor, scoreFor, type FaultCase } from "./money.ts";
import { unlockBond } from "./policy.ts";

const { jobs, payments, merchants, bondLedger, agents } = schema;

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];
const nextDelay = (attempts: number) => BACKOFF_MS[attempts] ?? 300_000;

export function enqueue(db: Db, kind: Job["kind"], payload: Record<string, unknown>, delayMs = 0) {
  // One pending Arkiv job per merchant (batching).
  if (kind === "arkiv") {
    const existing = db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.kind, "arkiv"), isNull(jobs.doneAt), sql`json_extract(${jobs.payload}, '$.merchantId') = ${payload.merchantId}`))
      .get();
    if (existing) return existing.id;
  }
  const id = newId("job");
  db.insert(jobs).values({ id, kind, payload, nextRunAt: Date.now() + delayMs }).run();
  return id;
}

/** Recompute counters/score for a merchant and queue the Arkiv publish. */
export function recordOutcome(db: Db, merchantId: string, failure: boolean, counts: boolean) {
  if (!counts) return;
  const m = db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
  if (!m) return;
  const totalCalls = m.totalCalls + 1;
  const failedCalls = m.failedCalls + (failure ? 1 : 0);
  db.update(merchants).set({ totalCalls, failedCalls, score: scoreFor(totalCalls, failedCalls) })
    .where(eq(merchants.id, merchantId)).run();
  if (hasArkiv()) enqueue(db, "arkiv", { merchantId }, 10_000);
}

// Chain modules are loaded lazily so unit tests never touch the network.
type Chain = {
  refundFromBond: typeof import("./chain/hedera.ts").refundFromBond;
  refundFromGateway: typeof import("./chain/hedera.ts").refundFromGateway;
  publishReceipt: typeof import("./chain/hedera.ts").publishReceipt;
  newRefundTxId: typeof import("./chain/hedera.ts").newRefundTxId;
  txExists: typeof import("./chain/mirror.ts").txExists;
  createReputation: typeof import("./chain/arkiv.ts").createReputation;
  updateReputation: typeof import("./chain/arkiv.ts").updateReputation;
};

let chain: Chain | null = null;
async function loadChain(): Promise<Chain> {
  if (chain) return chain;
  const h = await import("./chain/hedera.ts");
  const m = await import("./chain/mirror.ts");
  const a = hasArkiv() ? await import("./chain/arkiv.ts") : null;
  chain = {
    refundFromBond: h.refundFromBond,
    refundFromGateway: h.refundFromGateway,
    publishReceipt: h.publishReceipt,
    newRefundTxId: h.newRefundTxId,
    txExists: m.txExists,
    createReputation: a?.createReputation ?? (async () => { throw new Error("arkiv_disabled"); }),
    updateReputation: a?.updateReputation ?? (async () => { throw new Error("arkiv_disabled"); }),
  };
  return chain;
}

export function receiptMessage(db: Db, paymentId: string) {
  const p = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!p) throw new Error("payment_missing");
  const m = db.select({ slug: merchants.slug }).from(merchants).where(eq(merchants.id, p.merchantId)).get();
  const a = db.select({ acct: agents.hederaAccountId }).from(agents).where(eq(agents.id, p.agentId)).get();
  return {
    v: 1,
    paymentId: p.id,
    agent: a?.acct,
    merchant: m?.slug,
    price: String(p.price),
    fee: String(p.fee),
    outcome: p.status,
    reason: p.failureReason,
    case: p.faultCase,
    agentTx: p.agentTxId,
    merchantTx: p.merchantTxId,
    refundTx: p.refundTxId,
    responseSha256: p.responseHash,
    latencyMs: p.latencyMs,
    ts: Math.floor(Date.now() / 1000),
  };
}

async function runRefund(db: Db, job: Job, c: Chain) {
  const paymentId = String(job.payload.paymentId);
  const p = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!p || p.status !== "refund_pending") return;
  const agent = db.select().from(agents).where(eq(agents.id, p.agentId)).get();
  if (!agent) throw new Error("agent_missing");
  const out = outcomeFor(p.faultCase as FaultCase, p.price);

  // Fixed tx id saved before submit, so a crash cannot cause a second refund.
  let txId = job.payload.txId as string | undefined;
  if (!txId) {
    txId = c.newRefundTxId();
    db.update(jobs).set({ payload: { ...job.payload, txId } }).where(eq(jobs.id, job.id)).run();
  } else if (job.attempts > 0 && (await c.txExists(txId))) {
    finalizeRefund(db, p.id, p.merchantId, txId, out.slash, out.refundToAgent);
    return;
  }

  try {
    const res = out.refundFrom === "vault"
      ? await c.refundFromBond({ paymentId: p.id, agent: agent.hederaAccountId, price: p.price, penalty: out.slash - p.price, txId })
      : await c.refundFromGateway({ paymentId: p.id, agent: agent.hederaAccountId, amount: out.refundToAgent, txId });
    if (res.status !== "SUCCESS") throw new Error(`refund_status_${res.status}`);
    finalizeRefund(db, p.id, p.merchantId, res.txId, out.slash, out.refundToAgent);
  } catch (err) {
    // A reused/expired tx id must be regenerated on the next attempt.
    const msg = String(err);
    if (/DUPLICATE_TRANSACTION|TRANSACTION_EXPIRED|INVALID_TRANSACTION_START/.test(msg)) {
      db.update(jobs).set({ payload: { paymentId } }).where(eq(jobs.id, job.id)).run();
    }
    throw err;
  }
}

function finalizeRefund(db: Db, paymentId: string, merchantId: string, txId: string, slash: number, refunded: number) {
  db.transaction((tx) => {
    tx.update(payments).set({ status: "refunded", refundTxId: txId, refundAmount: refunded, slashAmount: slash, finishedAt: Date.now() })
      .where(eq(payments.id, paymentId)).run();
    if (slash > 0) {
      tx.insert(bondLedger).values({ id: newId("led"), merchantId, type: "slash", amount: -slash, txId, paymentId }).run();
      tx.run(sql`update merchants set bond_balance = bond_balance - ${slash}, bond_locked = max(0, bond_locked - ${slash}) where id = ${merchantId}`);
      // Auto-pause when the bond can no longer cover a call.
      tx.run(sql`update merchants set status = 'paused' where id = ${merchantId} and status = 'live' and bond_balance - bond_locked < (price + price * ${env.penaltyBps} / 10000)`);
    }
  });
  enqueue(db, "hcs", { paymentId });
}

async function runHcs(db: Db, job: Job, c: Chain) {
  if (!hasHcs()) return; // nothing to do without a topic
  const paymentId = String(job.payload.paymentId);
  const seq = await c.publishReceipt(receiptMessage(db, paymentId));
  db.update(payments).set({ hcsSequence: seq }).where(eq(payments.id, paymentId)).run();
}

async function runArkiv(db: Db, job: Job, c: Chain) {
  const m = db.select().from(merchants).where(eq(merchants.id, String(job.payload.merchantId))).get();
  if (!m) return;
  // Publish the real success rate even before the 5-call threshold: totalCalls travels with it,
  // so readers can tell a new merchant from an established one. Never publish a made-up 100.
  const rate = m.totalCalls > 0 ? Math.round((100 * (m.totalCalls - m.failedCalls)) / m.totalCalls) : 0;
  const stats = { merchantId: m.id, slug: m.slug, score: m.score ?? rate, totalCalls: m.totalCalls, failedCalls: m.failedCalls };
  if (m.arkivEntityKey) {
    await c.updateReputation(m.arkivEntityKey, stats);
  } else {
    const key = await c.createReputation(stats);
    db.update(merchants).set({ arkivEntityKey: key }).where(eq(merchants.id, m.id)).run();
  }
}

export async function runDueJobs(db: Db, log = console) {
  const due = db.select().from(jobs).where(and(isNull(jobs.doneAt), lte(jobs.nextRunAt, Date.now()))).limit(20).all();
  if (due.length === 0) return;
  const c = await loadChain();
  for (const job of due) {
    try {
      if (job.kind === "refund") await runRefund(db, job, c);
      else if (job.kind === "hcs") await runHcs(db, job, c);
      else await runArkiv(db, job, c);
      db.update(jobs).set({ doneAt: Date.now(), lastError: null }).where(eq(jobs.id, job.id)).run();
    } catch (err) {
      const attempts = job.attempts + 1;
      const msg = String(err instanceof Error ? err.message : err).slice(0, 500);
      log.warn(`[worker] ${job.kind} ${job.id} attempt ${attempts} failed: ${msg}`);
      if (job.kind === "refund" && attempts >= 5) {
        db.update(payments).set({ status: "refund_failed", finishedAt: Date.now() })
          .where(eq(payments.id, String(job.payload.paymentId))).run();
        db.update(jobs).set({ doneAt: Date.now(), attempts, lastError: msg }).where(eq(jobs.id, job.id)).run();
        continue;
      }
      db.update(jobs).set({ attempts, lastError: msg, nextRunAt: Date.now() + nextDelay(attempts) }).where(eq(jobs.id, job.id)).run();
    }
  }
}

/** Startup: any payment stuck in `calling` for 2+ minutes is our fault (case C). */
export function recoverStuckPayments(db: Db) {
  const stale = db.select().from(payments)
    .where(and(eq(payments.status, "calling"), lte(payments.createdAt, Date.now() - 120_000))).all();
  for (const p of stale) {
    db.update(payments).set({ status: "refund_pending", faultCase: "C", failureReason: "gateway_error", failureDetail: "gateway restarted mid-call" })
      .where(eq(payments.id, p.id)).run();
    const m = db.select().from(merchants).where(eq(merchants.id, p.merchantId)).get();
    if (m) unlockBond(db, m.id, m.price + Math.floor((m.price * env.penaltyBps) / 10_000));
    enqueue(db, "refund", { paymentId: p.id });
  }
  return stale.length;
}

export function startWorker(db: Db, intervalMs = 1000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runDueJobs(db); } catch (e) { console.error("[worker]", e); } finally { running = false; }
  }, intervalMs);
  return () => clearInterval(timer);
}
