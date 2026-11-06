import { Hono, type Context } from "hono";
import { zValidator } from "../validate.ts";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { allowlistSchema, applyGatewayReply, askSchema, createAgentSchema, patchAgentSchema, playSchema, scheduleFundingSchema, PIPELINE_STEPS, type DemoRunResult } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { env, hasHcs } from "../env.ts";
import { agentUaid, registrationMessage } from "../hcs14.ts";
import { newApiKey, newId, sha256 } from "../ids.ts";
import { askAsAgent } from "../ask.ts";
import { consumeStepUp, requireRole, stepUpRequired, type Session } from "../auth.ts";
import { hasAgentPass } from "../chain/agentpass.ts";
import { totalFor } from "../money.ts";
import { todaySpend } from "../policy.ts";
import { buildReceipt } from "../receipt.ts";
import { toPublicMerchant } from "./public.ts";

const { agents, allowedMerchants, merchants, payments, approvals, fundingSchedules } = schema;

type Vars = { Variables: { session: Session } };

/**
 * Gives an agent its HCS-14 id and announces it on the HCS topic. Best effort: the id is stored even
 * when the topic is off or the publish fails, so the agent is usable at once and the announcement can be retried.
 */
export async function registerUaid(db: Db, a: typeof agents.$inferSelect, log = console) {
  const uaid = a.uaid ?? agentUaid({ id: a.id, name: a.name, account: a.hederaAccountId, network: env.network });
  let uaidSeq = a.uaidSeq;
  if (hasHcs() && uaidSeq == null) {
    try {
      const { publishReceipt } = await import("../chain/hedera.ts");
      uaidSeq = await publishReceipt(registrationMessage({ uaid, name: a.name, account: a.hederaAccountId }));
    } catch (err) { log.warn(`[hcs-14] could not announce ${a.id}: ${String(err)}`); }
  }
  db.update(agents).set({ uaid, uaidSeq }).where(eq(agents.id, a.id)).run();
  return { uaid, uaidSeq };
}

/** Startup: agents created before HCS-14 support get their id now. */
export async function backfillUaids(db: Db, log = console) {
  const missing = db.select().from(agents).where(isNull(agents.uaid)).all();
  for (const a of missing) await registerUaid(db, a, log);
  if (missing.length) log.log(`[hcs-14] registered ${missing.length} agent id(s)`);
}

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
    const { apiKeyHash: _h, custodialEnc, ...rest } = a;
    const allowed = db.select().from(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).all();
    const last = db.select({ t: payments.createdAt }).from(payments).where(eq(payments.agentId, a.id)).orderBy(desc(payments.createdAt)).limit(1).get();
    const scheduled = db.select().from(fundingSchedules).where(eq(fundingSchedules.agentId, a.id)).orderBy(fundingSchedules.executeAt).all()
      .map((s) => ({ scheduleId: s.scheduleId, amount: s.amount, executeAt: s.executeAt }));
    // Per-merchant limits with today's use, so the owner sees how much room is left at each merchant.
    const merchantCaps = Object.fromEntries(allowed.filter((x) => x.dailyCap != null).map((x) => [x.merchantId, { dailyCap: x.dailyCap!, spentToday: todaySpend(db, a.id, Date.now(), x.merchantId) }]));
    return { ...rest, custodial: Boolean(custodialEnc), spentToday: todaySpend(db, a.id), allowedMerchantIds: allowed.map((x) => x.merchantId), merchantCaps, lastPaymentAt: last?.t ?? null, scheduledFunding: scheduled };
  };

  app.get("/agents", (c) => {
    const rows = db.select().from(agents).where(eq(agents.ownerId, c.get("session").sub)).all();
    return c.json(rows.map(publicAgent));
  });

  app.post("/agents", zValidator("json", createAgentSchema), async (c) => {
    const body = c.req.valid("json");
    const apiKey = newApiKey();
    const id = newId("agt");
    let hederaAccountId = body.hederaAccountId;
    let custodialEnc: string | null = null;
    if (!hederaAccountId) {
      // No account given: create a custodial testnet wallet so the owner can pay from the playground.
      try {
        const { createAgentWallet, seal } = await import("../custody.ts");
        const w = await createAgentWallet(body.name);
        hederaAccountId = w.accountId;
        custodialEnc = seal({ walletKey: w.walletKey, apiKey });
      } catch (err) {
        return c.json({ error: "wallet_create_failed", detail: String(err) }, 502);
      }
    }
    try {
      db.insert(agents).values({ id, ownerId: c.get("session").sub, apiKeyHash: sha256(apiKey), ...body, hederaAccountId, custodialEnc }).run();
    } catch (err) {
      return c.json({ error: "hedera_account_in_use", detail: String(err) }, 409);
    }
    await registerUaid(db, db.select().from(agents).where(eq(agents.id, id)).get()!);
    const a = db.select().from(agents).where(eq(agents.id, id)).get()!;
    return c.json({ ...publicAgent(a), apiKey }, 201); // key shown once
  });

  /** Demo mode: queue `times` top-ups as Scheduled Transactions; the network moves the USDC at each time. */
  app.post("/agents/:id/fund/schedule", zValidator("json", scheduleFundingSchema), async (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!env.demoMode) return c.json({ error: "not_in_demo_mode" }, 403);
    if (!a.custodialEnc) return c.json({ error: "not_custodial" }, 400);
    const { amount, everySec, times } = c.req.valid("json");
    const created: { scheduleId: string; amount: number; executeAt: number }[] = [];
    try {
      const { scheduleFunding } = await import("../custody.ts");
      for (let i = 1; i <= times; i++) {
        const executeAt = Date.now() + i * everySec * 1000;
        const { scheduleId } = await scheduleFunding(a.hederaAccountId, amount, new Date(executeAt));
        db.insert(fundingSchedules).values({ scheduleId, agentId: a.id, amount, executeAt }).run();
        created.push({ scheduleId, amount, executeAt });
      }
    } catch (err) {
      if (!created.length) return c.json({ error: "schedule_failed", detail: String(err) }, 502);
    }
    return c.json({ created }, 201); // partial success still reports what is on-chain
  });

  /** Demo mode: top up a custodial wallet with 0.5 testnet USDC from the gateway. */
  app.post("/agents/:id/fund", async (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!env.demoMode) return c.json({ error: "not_in_demo_mode" }, 403);
    if (!a.custodialEnc) return c.json({ error: "not_custodial" }, 400);
    try {
      const { fundAgent } = await import("../custody.ts");
      const amount = 500_000;
      return c.json({ amount, ...(await fundAgent(a.hederaAccountId, amount)) });
    } catch (err) {
      return c.json({ error: "fund_failed", detail: String(err) }, 502);
    }
  });

  /**
   * Console: the owner asks for something; the agent chooses the merchant itself (allowed, covered,
   * within the per-call cap, best Arkiv score first) and pays for real. The reply carries the data,
   * or exactly why nothing was delivered, so the UI can say it in plain words.
   */
  app.post("/agents/:id/ask", zValidator("json", askSchema), async (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!a.custodialEnc) return c.json({ error: "not_custodial" }, 400);
    return c.json(await askAsAgent(db, a, c.req.valid("json")));
  });

  /** Playground: the custodial agent makes one real paid call through /v1/call and reports each step. */
  app.post("/agents/:id/play", zValidator("json", playSchema), async (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!a.custodialEnc) return c.json({ error: "not_custodial" }, 400);
    const { slug, body, approvalId } = c.req.valid("json");
    const m = db.select().from(merchants).where(eq(merchants.slug, slug)).get();
    if (!m) return c.json({ error: "merchant_not_found" }, 404);

    const steps = PIPELINE_STEPS();
    const result: DemoRunResult = { scenario: slug, outcome: "error", paymentId: null, steps, gatewayStatus: null, gatewayResponse: null };
    try {
      const { payAsAgent, unseal } = await import("../custody.ts");
      const { walletKey, apiKey } = unseal(a.custodialEnc);
      const r = await payAsAgent({ accountId: a.hederaAccountId, walletKey, apiKey, slug, body, approvalId });
      result.gatewayStatus = r.status;
      result.gatewayResponse = r.body;
      Object.assign(result, applyGatewayReply(steps, { ...r, price: m.price, total: totalFor(m.price), hashscan: env.hashscan }));
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      Object.assign(steps[0]!, { state: "failed", detail: msg.slice(0, 200) });
      result.error = msg;
    }
    return c.json(result);
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
  app.post("/agents/:id/rotate-key", async (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    if (!consumeStepUp(db, c.get("session"), `agent:${a.id}:key`)) return stepUpRequired(c, `agent:${a.id}:key`);
    const apiKey = newApiKey();
    let custodialEnc = a.custodialEnc;
    if (custodialEnc) {
      const { seal, unseal } = await import("../custody.ts");
      custodialEnc = seal({ ...unseal(custodialEnc), apiKey }); // the custodial agent must keep paying with the new key
    }
    db.update(agents).set({ apiKeyHash: sha256(apiKey), custodialEnc }).where(eq(agents.id, a.id)).run();
    return c.json({ ...publicAgent(db.select().from(agents).where(eq(agents.id, a.id)).get()!), apiKey });
  });

  app.put("/agents/:id/allowlist", zValidator("json", allowlistSchema), (c) => {
    const a = ownAgent(c, c.req.param("id"));
    if (!a) return c.json({ error: "not_found" }, 404);
    const { merchantIds, dailyCaps } = c.req.valid("json");
    const valid = merchantIds.length
      ? db.select({ id: merchants.id }).from(merchants).where(inArray(merchants.id, merchantIds)).all().map((m) => m.id)
      : [];
    db.transaction((tx) => {
      tx.delete(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).run();
      if (valid.length) tx.insert(allowedMerchants).values(valid.map((merchantId) => ({ agentId: a.id, merchantId, dailyCap: dailyCaps[merchantId] ?? null }))).run();
    });
    return c.json({ merchantIds: valid, dailyCaps: Object.fromEntries(valid.filter((id) => dailyCaps[id] != null).map((id) => [id, dailyCaps[id]])) });
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
