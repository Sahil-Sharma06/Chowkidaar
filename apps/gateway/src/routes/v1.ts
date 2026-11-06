import { Hono } from "hono";
import { zValidator } from "../validate.ts";
import { eq } from "drizzle-orm";
import { askSchema } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { askAsAgent } from "../ask.ts";
import { feeFor, totalFor } from "../money.ts";
import { findAgentByKey, todaySpend } from "../policy.ts";
import { buildReceipt } from "../receipt.ts";
import { toPublicMerchant } from "./public.ts";

const { merchants, payments, allowedMerchants } = schema;

/** Agent-facing routes, authenticated by `x-agent-key`. The paid route lives in app.ts because of middleware ordering. */
export function v1Routes(db: Db) {
  const app = new Hono();

  app.get("/merchants/:slug", (c) => {
    const m = db.select().from(merchants).where(eq(merchants.slug, c.req.param("slug"))).get();
    if (!m) return c.json({ error: "not_found" }, 404);
    return c.json({ ...toPublicMerchant(m), fee: String(feeFor(m.price)), total: String(totalFor(m.price)), timeoutMs: m.timeoutMs });
  });

  app.get("/payments/:id", (c) => {
    const agent = findAgentByKey(db, c.req.header("x-agent-key"));
    if (!agent) return c.json({ error: "invalid_agent_key" }, 401);
    const p = db.select({ agentId: payments.agentId }).from(payments).where(eq(payments.id, c.req.param("id"))).get();
    if (!p || p.agentId !== agent.id) return c.json({ error: "not_found" }, 404);
    return c.json(buildReceipt(db, c.req.param("id")));
  });

  /** Who am I: the agent behind this key, its limits and what it may pay. For MCP hosts and SDKs. */
  app.get("/agent", (c) => {
    const a = findAgentByKey(db, c.req.header("x-agent-key"));
    if (!a) return c.json({ error: "invalid_agent_key" }, 401);
    const allowed = db.select({ id: allowedMerchants.merchantId }).from(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).all().map((x) => x.id);
    return c.json({
      id: a.id, name: a.name, hederaAccountId: a.hederaAccountId, uaid: a.uaid, custodial: Boolean(a.custodialEnc), status: a.status,
      perCallCap: String(a.perCallCap), dailyCap: String(a.dailyCap), approvalThreshold: String(a.approvalThreshold), minScore: a.minScore,
      allowlistOnly: a.allowlistOnly, allowedMerchantIds: allowed, spentToday: String(todaySpend(db, a.id)),
    });
  });

  /**
   * Ask in plain words; the agent picks the merchant and pays. Same behaviour as the web console,
   * keyed by the agent's API key instead of a session, so an MCP host (Claude, ChatGPT) can use it.
   * Only for agents whose wallet the gateway holds; agents with their own key use /v1/call directly.
   */
  app.post("/ask", zValidator("json", askSchema), async (c) => {
    const a = findAgentByKey(db, c.req.header("x-agent-key"));
    if (!a) return c.json({ error: "invalid_agent_key" }, 401);
    if (!a.custodialEnc) return c.json({ error: "not_custodial", detail: "This agent pays with its own key: call POST /v1/call/{slug} with an x402 client instead." }, 400);
    return c.json(await askAsAgent(db, a, c.req.valid("json")));
  });

  return app;
}
