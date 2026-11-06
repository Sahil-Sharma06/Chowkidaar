import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../src/db/index.ts";
import { checkPolicy, lockBond, unlockBond } from "../src/policy.ts";
import { API_KEY, addMerchant, freshDb } from "./helpers.ts";

const call = (db: ReturnType<typeof freshDb>, over: Record<string, unknown> = {}) =>
  checkPolicy(db, { apiKey: API_KEY, slug: "good-data", ...over });

describe("policy", () => {
  it("passes a normal call", () => {
    const db = freshDb(); addMerchant(db);
    const r = call(db);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.fee).toBe(2_000); expect(r.total).toBe(102_000); }
  });

  it("1. invalid key", () => {
    const db = freshDb(); addMerchant(db);
    expect(call(db, { apiKey: "nope" })).toMatchObject({ ok: false, status: 401, code: "invalid_agent_key" });
    expect(call(db, { apiKey: undefined })).toMatchObject({ ok: false, status: 401 });
  });

  it("2. merchant missing or not live", () => {
    const db = freshDb(); addMerchant(db, { status: "paused" });
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_not_available" });
    expect(call(db, { slug: "ghost" })).toMatchObject({ ok: false, code: "merchant_not_available" });
  });

  it("3. per-call cap", () => {
    const db = freshDb(); addMerchant(db, { price: 600_000, bondBalance: 10_000_000 });
    expect(call(db)).toMatchObject({ ok: false, code: "per_call_cap_exceeded" });
  });

  it("4. daily cap counts today's spend minus refunds", () => {
    const db = freshDb(); addMerchant(db);
    db.update(schema.agents).set({ dailyCap: 200_000, approvalThreshold: 500_000 }).run();
    db.insert(schema.payments).values({ id: "p1", agentId: "agt_1", merchantId: "mer_good-data", price: 100_000, fee: 2_000, status: "delivered", agentTxId: "t1" }).run();
    expect(call(db)).toMatchObject({ ok: false, code: "daily_cap_exceeded" });
    db.update(schema.payments).set({ status: "refunded", refundAmount: 100_000 }).where(eq(schema.payments.id, "p1")).run();
    expect(call(db).ok).toBe(true);
  });

  it("5. allowlist", () => {
    const db = freshDb(); addMerchant(db);
    db.delete(schema.allowedMerchants).run();
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_not_allowed" });
    db.update(schema.agents).set({ allowlistOnly: false }).run();
    expect(call(db).ok).toBe(true);
  });

  it("5b. per-merchant daily cap, enforced even with the allowlist off", () => {
    const db = freshDb(); addMerchant(db);
    db.update(schema.agents).set({ approvalThreshold: 500_000 }).run();
    db.update(schema.allowedMerchants).set({ dailyCap: 150_000 }).run();
    expect(call(db).ok).toBe(true); // 102_000 fits
    db.insert(schema.payments).values({ id: "p1", agentId: "agt_1", merchantId: "mer_good-data", price: 100_000, fee: 2_000, status: "delivered", agentTxId: "t1" }).run();
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_daily_cap_exceeded" });
    db.update(schema.agents).set({ allowlistOnly: false }).run();
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_daily_cap_exceeded" });
    db.update(schema.allowedMerchants).set({ dailyCap: null }).run();
    expect(call(db).ok).toBe(true);
  });

  it("6. low reputation, null score passes", () => {
    const db = freshDb(); addMerchant(db, { score: 50 });
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_low_reputation" });
    db.update(schema.merchants).set({ score: null }).run();
    expect(call(db).ok).toBe(true);
  });

  it("7. bond coverage uses available = balance - locked", () => {
    const db = freshDb(); addMerchant(db, { bondBalance: 200_000, bondLocked: 100_000 });
    expect(call(db)).toMatchObject({ ok: false, code: "merchant_not_covered" });
  });

  it("8. approval above threshold, single use, expiry", () => {
    const db = freshDb(); addMerchant(db);
    db.update(schema.agents).set({ approvalThreshold: 50_000 }).run();
    const first = call(db);
    expect(first).toMatchObject({ ok: false, status: 202, code: "approval_required" });
    const id = (first as { approvalId: string }).approvalId;
    // Same pending approval is reused, not duplicated.
    expect((call(db) as { approvalId: string }).approvalId).toBe(id);
    expect(call(db, { approvalId: id })).toMatchObject({ ok: false, status: 202 }); // still pending
    db.update(schema.approvals).set({ status: "approved" }).where(eq(schema.approvals.id, id)).run();
    const ok = call(db, { approvalId: id });
    expect(ok.ok).toBe(true);
    db.update(schema.approvals).set({ status: "used" }).where(eq(schema.approvals.id, id)).run();
    expect(call(db, { approvalId: id })).toMatchObject({ ok: false, status: 202 });
    db.update(schema.approvals).set({ status: "approved", expiresAt: Date.now() - 1 }).where(eq(schema.approvals.id, id)).run();
    expect(call(db, { approvalId: id })).toMatchObject({ ok: false, status: 202 });
  });

  it("bond lock is atomic: two calls cannot take the same bond", () => {
    const db = freshDb(); const m = addMerchant(db, { bondBalance: 120_000 });
    expect(lockBond(db, m.id, 120_000)).toBe(true);
    expect(lockBond(db, m.id, 120_000)).toBe(false);
    unlockBond(db, m.id, 120_000);
    expect(lockBond(db, m.id, 120_000)).toBe(true);
  });
});
