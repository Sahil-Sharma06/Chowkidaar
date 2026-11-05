import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { allowlistSchema, createAgentSchema, patchAgentSchema } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { newApiKey, newId, sha256 } from "../ids.ts";
import { consumeStepUp, requireRole, stepUpRequired, type Session } from "../auth.ts";
import { hasAgentPass } from "../chain/agentpass.ts";
import { todaySpend } from "../policy.ts";
import { buildReceipt } from "../receipt.ts";
import { toPublicMerchant } from "./public.ts";

const { agents, allowedMerchants, merchants, payments, approvals } = schema;

type Vars = { Variables: { session: Session } };

type Limits = { perCallCap: number; dailyCap: number; approvalThreshold: number; minScore: number; allowlistOnly: boolean };
/** True when the change lets the agent spend more, or with less oversight, than before. */
export function loosens(before: Limits, after: Limits) {
  return after.perCallCap > before.perCallCap
    || after.dailyCap > before.dailyCap
    || after.approvalThreshold > before.approvalThreshold
    || after.minScore < before.minScore
    || (before.allowlistOnly && !after.allowlistOnly);
}

export function agentRoutes(db: Db) {
  const app = new Hono<Vars>();
  for (const p of ["/agents", "/agents/*", "/owner/*", "/approvals", "/approvals/*"]) app.use(p, requireRole(db, "owner"));

  const ownAgent = (c: { get(k: "session"): Session }, id: string) =>
    db.select().from(agents).where(and(eq(agents.id, id), eq(agents.ownerId, c.get("session").sub))).get();

  const publicAgent = (a: typeof agents.$inferSelect) => {
    const { apiKeyHash: _h, ...rest } = a;
    const allowed = db.select({ id: allowedMerchants.merchantId }).from(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).all();
    const last = db.select({ t: payments.createdAt }).from(payments).where(eq(payments.agentId, a.id)).orderBy(desc(payments.createdAt)).limit(1).get();
    return { ...rest, spentToday: todaySpend(db, a.id), allowedMerchantIds: allowed.map((x) => x.id), lastPaymentAt: last?.t ?? null };
  };

  app.get("/agents", (c) => {
    const rows = db.select().from(agents).where(eq(agents.ownerId, c.get("session").sub)).all();
    return c.json(rows.map(publicAgent));
  });

  app.post("/agents", zValidator("json", createAgentSchema), (c) => {
    const body = c.req.valid("json");
    const apiKey = newApiKey();
    const id = newId("agt");
    try {
      db.insert(agents).values({ id, ownerId: c.get("session").sub, apiKeyHash: sha256(apiKey), ...body }).run();
    } catch (err) {
      return c.json({ error: "hedera_account_in_use", detail: String(err) }, 409);
    }
    const a = db.select().from(agents).where(eq(agents.id, id)).get()!;
    return c.json({ ...publicAgent(a), apiKey }, 201); // key shown once
  });

  app.get("/agents/:id", (c) => {
    const a = ownAgent(c, c.req.param("id"));
    return a ? c.json(publicAgent(a)) : c.json({ error: "not_found" }, 404);
  });

  app.patch("/agents/:id", zValidator("json", patchAgentSchema), (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    const patch = c.req.valid("json");
    const next = { ...a, ...patch };
    if (next.dailyCap < next.perCallCap) return c.json({ error: "daily_cap_below_per_call" }, 400);
    if (next.approvalThreshold > next.perCallCap) return c.json({ error: "approval_above_per_call" }, 400);
    // Loosening a control lets the agent spend more without asking: that needs a fresh World ID check.
    // Tightening (lower caps, pause, allowlist on) never does, so an owner can always stop spending fast.
    if (loosens(a, next) && !consumeStepUp(db, c.get("session"), `agent:${a.id}:limits`)) {
      return stepUpRequired(c, `agent:${a.id}:limits`);
    }
    db.update(agents).set(patch).where(eq(agents.id, a.id)).run();
    return c.json(publicAgent(db.select().from(agents).where(eq(agents.id, a.id)).get()!));
  });

  /** Replaces the agent's API key. The old key stops working at once; the new one is shown once. */
  app.post("/agents/:id/rotate-key", (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!consumeStepUp(db, c.get("session"), `agent:${a.id}:key`)) return stepUpRequired(c, `agent:${a.id}:key`);
    const apiKey = newApiKey();
    db.update(agents).set({ apiKeyHash: sha256(apiKey) }).where(eq(agents.id, a.id)).run();
    return c.json({ ...publicAgent(db.select().from(agents).where(eq(agents.id, a.id)).get()!), apiKey });
  });

  app.put("/agents/:id/allowlist", zValidator("json", allowlistSchema), (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    const { merchantIds } = c.req.valid("json");
    const valid = merchantIds.length
      ? db.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, merchantIds)).all().map((m) => m.id)
      : [];
    db.transaction((tx) => {
      tx.delete(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).run();
      if (valid.length) tx.insert(allowedMerchants).values(valid.map((merchantId) => ({ agentId: a.id, merchantId }))).run();
    });
    return c.json({ merchantIds: valid });
  });

  app.get("/agents/:id/payments", (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    const rows = db.select({ id: payments.id }).from(payments).where(eq(payments.agentId, a.id)).orderBy(desc(payments.createdAt)).limit(100).all();
    return c.json(rows.map((r) => buildReceipt(db, r.id)));
  });

  app.get("/owner/payments", (c) => {
    const ids = db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, c.get("session").sub)).all().map((a) => a.id);
    if (!ids.length) return c.json([]);
    const rows = db.select({ id: payments.id }).from(payments).where(inArray(payments.agentId, ids)).orderBy(desc(payments.createdAt)).limit(50).all();
    return c.json(rows.map((r) => buildReceipt(db, r.id)));
  });

  app.get("/owner/merchants", (c) => c.json(
    db.select().from(merchants).where(inArray(merchants.status, ["live", "paused", "needs_bond"])).all().map(toPublicMerchant),
  ));

  app.get("/approvals", (c) => {
    const ids = db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, c.get("session").sub)).all().map((a) => a.id);
    if (!ids.length) return c.json([]);
    const status = c.req.query("status") ?? "pending";
    const rows = db.select({
      approval: approvals, agentName: agents.name, merchantName: merchants.name, merchantSlug: merchants.slug, merchantScore: merchants.score,
    }).from(approvals)
      .innerJoin(agents, eq(agents.id, approvals.agentId))
      .innerJoin(merchants, eq(merchants.id, approvals.merchantId))
      .where(and(inArray(approvals.agentId, ids), eq(approvals.status, status as never), status === "pending" ? gte(approvals.expiresAt, Date.now()) : undefined))
      .orderBy(desc(approvals.createdAt)).all();
    return c.json(rows.map((r) => ({ ...r.approval, agentName: r.agentName, merchantName: r.merchantName, merchantSlug: r.merchantSlug, merchantScore: r.merchantScore })));
  });

  const decide = (status: "approved" | "rejected") => (c: Context<Vars>) => {
    // With Agent Pass, approving happens only in the OIDC callback after a fresh verification.
    // Rejecting is always allowed directly: refusing to pay never needs extra proof.
    if (status === "approved" && hasAgentPass()) return c.json({ error: "step_up_required", via: "agent_pass" }, 403);
    const ids = db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, c.get("session").sub)).all().map((a) => a.id);
    const a = db.select().from(approvals).where(eq(approvals.id, c.req.param("id") ?? "")).get();
    if (!a || !ids.includes(a.agentId)) return c.json({ error: "not_found" }, 404);
    if (a.status !== "pending") return c.json({ error: "already_decided" }, 409);
    if (a.expiresAt < Date.now()) { db.update(approvals).set({ status: "expired" }).where(eq(approvals.id, a.id)).run(); return c.json({ error: "expired" }, 410); }
    db.update(approvals).set({ status }).where(eq(approvals.id, a.id)).run();
    return c.json({ ...a, status });
  };
  app.post("/approvals/:id/approve", decide("approved"));
  app.post("/approvals/:id/reject", decide("rejected"));

  return app;
}
