import { eq } from "drizzle-orm";
import { arkivEntityUrl, hashscanTopic, hashscanTx, type Receipt } from "@app/shared";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import { env } from "./env.ts";
import { outcomeFor, type FaultCase } from "./money.ts";

const { payments, merchants, agents } = schema;

export function buildReceipt(db: Db, paymentId: string): Receipt | null {
  const p = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!p) return null;
  const m = db.select().from(merchants).where(eq(merchants.id, p.merchantId)).get();
  const a = db.select().from(agents).where(eq(agents.id, p.agentId)).get();
  if (!m || !a) return null;

  const final = p.status === "refunded" || p.status === "delivered" || p.status === "refund_failed";
  const kind: "delivered" | FaultCase | null = p.status === "delivered" ? "delivered" : (p.faultCase as FaultCase | null);
  const out = kind ? outcomeFor(kind, p.price) : null;
  const refunded = p.status === "refunded" ? (p.refundAmount ?? out?.refundToAgent ?? 0) : 0;
  const slashed = p.status === "refunded" ? (p.slashAmount ?? out?.slash ?? 0) : 0;
  const merchantReceived = p.merchantPaid ? p.price : 0;
  const feeKept = out ? (out.feeKept ? p.fee : 0) : p.fee;

  const hcsLink = p.hcsSequence && env.hcsTopicId ? `${hashscanTopic(env.hcsTopicId, env.hashscan)}?seq=${p.hcsSequence}` : null;

  return {
    paymentId: p.id,
    status: p.status,
    reason: p.failureReason,
    detail: p.failureDetail,
    faultCase: (p.faultCase as FaultCase | null) ?? null,
    merchant: { id: m.id, slug: m.slug, name: m.name },
    agentAccount: a.hederaAccountId,
    agentName: a.name,
    money: {
      price: String(p.price),
      fee: String(p.fee),
      agentPaid: String(p.price + p.fee),
      merchantReceived: String(merchantReceived),
      refunded: String(refunded),
      feeKept: String(final ? feeKept : 0),
      bondSlashed: String(slashed),
    },
    tx: { agent: p.agentTxId, merchant: p.merchantTxId, refund: p.refundTxId },
    links: {
      agent: p.agentTxId ? hashscanTx(p.agentTxId, env.hashscan) : null,
      merchant: p.merchantTxId ? hashscanTx(p.merchantTxId, env.hashscan) : null,
      refund: p.refundTxId ? hashscanTx(p.refundTxId, env.hashscan) : null,
      hcs: hcsLink,
      arkiv: m.arkivEntityKey ? arkivEntityUrl(m.arkivEntityKey) : null,
    },
    hcs: { topicId: env.hcsTopicId || null, sequence: p.hcsSequence },
    arkivEntityKey: m.arkivEntityKey,
    responseHash: p.responseHash,
    httpStatus: p.httpStatus,
    latencyMs: p.latencyMs,
    createdAt: p.createdAt,
    finishedAt: p.finishedAt,
  };
}
