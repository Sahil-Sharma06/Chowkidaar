import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { feeFor, totalFor } from "../money.ts";
import { findAgentByKey } from "../policy.ts";
import { buildReceipt } from "../receipt.ts";
import { toPublicMerchant } from "./public.ts";

const { merchants, payments } = schema;

/** Agent-facing read routes. The paid route lives in app.ts because of middleware ordering. */
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

  return app;
}
