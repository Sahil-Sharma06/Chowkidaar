import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import type { Agent, Merchant } from "./db/schema.ts";
import { sha256, newId } from "./ids.ts";
import { feeFor, lockFor, totalFor } from "./money.ts";

const { agents, merchants, allowedMerchants, payments, approvals } = schema;

export type PolicyOk = { ok: true; agent: Agent; merchant: Merchant; fee: number; total: number; approvalId: string | null };
export type PolicyFail = { ok: false; status: 401 | 403 | 202; code: string; approvalId?: string; expiresAt?: number };
export type PolicyResult = PolicyOk | PolicyFail;

export const APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Net spend since UTC midnight (paid minus refunded); for one merchant when `merchantId` is given. */
export function todaySpend(db: Db, agentId: string, now = Date.now(), merchantId?: string): number {
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const row = db
    .select({
      spent: sql<number>`coalesce(sum(${payments.price} + ${payments.fee}), 0)`,
      refunded: sql<number>`coalesce(sum(coalesce(${payments.refundAmount}, 0)), 0)`,
    })
    .from(payments)
    .where(and(eq(payments.agentId, agentId), gte(payments.createdAt, midnight.getTime()), merchantId ? eq(payments.merchantId, merchantId) : undefined))
    .get();
  return (row?.spent ?? 0) - (row?.refunded ?? 0);
}

export function findAgentByKey(db: Db, apiKey: string | undefined): Agent | undefined {
  if (!apiKey) return undefined;
  return db.select().from(agents).where(eq(agents.apiKeyHash, sha256(apiKey))).get();
}

/** Runs the 9 policy checks in order. No money moves here. */
export function checkPolicy(
  db: Db,
  input: { apiKey?: string; slug: string; approvalId?: string; now?: number },
): PolicyResult {
  const now = input.now ?? Date.now();

  const agent = findAgentByKey(db, input.apiKey);
  if (!agent) return { ok: false, status: 401, code: "invalid_agent_key" };
  if (agent.status !== "active") return { ok: false, status: 403, code: "agent_paused" };

  const merchant = db.select().from(merchants).where(eq(merchants.slug, input.slug)).get();
  if (!merchant || merchant.status !== "live") return { ok: false, status: 403, code: "merchant_not_available" };

  const fee = feeFor(merchant.price);
  const total = totalFor(merchant.price);

  if (total > agent.perCallCap) return { ok: false, status: 403, code: "per_call_cap_exceeded" };
  if (todaySpend(db, agent.id, now) + total > agent.dailyCap) return { ok: false, status: 403, code: "daily_cap_exceeded" };

  const allowed = db.select().from(allowedMerchants)
    .where(and(eq(allowedMerchants.agentId, agent.id), eq(allowedMerchants.merchantId, merchant.id))).get();
  if (agent.allowlistOnly && !allowed) return { ok: false, status: 403, code: "merchant_not_allowed" };
  // Per-merchant limit: set on the allowlist row, enforced whether or not the allowlist itself is on.
  if (allowed?.dailyCap != null && todaySpend(db, agent.id, now, merchant.id) + total > allowed.dailyCap) {
    return { ok: false, status: 403, code: "merchant_daily_cap_exceeded" };
  }

  if (merchant.score !== null && merchant.score < agent.minScore) {
    return { ok: false, status: 403, code: "merchant_low_reputation" };
  }

  if (merchant.bondBalance - merchant.bondLocked < lockFor(merchant.price)) {
    return { ok: false, status: 403, code: "merchant_not_covered" };
  }

  let approvalId: string | null = null;
  if (total > agent.approvalThreshold) {
    const a = input.approvalId
      ? db.select().from(approvals).where(eq(approvals.id, input.approvalId)).get()
      : undefined;
    const valid = a && a.agentId === agent.id && a.merchantId === merchant.id && a.amount === total
      && a.status === "approved" && a.expiresAt > now;
    if (!valid) {
      // Reuse a still-pending approval for the same agent/merchant/amount, else open one.
      const pending = db.select().from(approvals).where(and(
        eq(approvals.agentId, agent.id), eq(approvals.merchantId, merchant.id),
        eq(approvals.amount, total), eq(approvals.status, "pending"), gte(approvals.expiresAt, now),
      )).get();
      const id = pending?.id ?? newId("apr");
      const expiresAt = pending?.expiresAt ?? now + APPROVAL_TTL_MS;
      if (!pending) {
        db.insert(approvals).values({ id, agentId: agent.id, merchantId: merchant.id, amount: total, expiresAt }).run();
      }
      return { ok: false, status: 202, code: "approval_required", approvalId: id, expiresAt };
    }
    approvalId = a!.id;
  }

  return { ok: true, agent, merchant, fee, total, approvalId };
}

/** Atomic bond lock. Returns false if the merchant no longer has enough available. */
export function lockBond(db: Db, merchantId: string, amount: number): boolean {
  const res = db.run(sql`
    update merchants set bond_locked = bond_locked + ${amount}
    where id = ${merchantId} and bond_balance - bond_locked >= ${amount}`);
  return res.changes === 1;
}

export function unlockBond(db: Db, merchantId: string, amount: number) {
  db.run(sql`update merchants set bond_locked = max(0, bond_locked - ${amount}) where id = ${merchantId}`);
}
