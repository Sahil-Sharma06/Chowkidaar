import { Hono } from "hono";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { PublicMerchant, PublicStats } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { env, hasArkiv, hasHcs, hasWorld } from "../env.ts";
import { lockFor } from "../money.ts";
import { buildReceipt } from "../receipt.ts";

const { merchants, payments } = schema;

export function toPublicMerchant(m: typeof merchants.$inferSelect): PublicMerchant {
  const available = m.bondBalance - m.bondLocked;
  return {
    id: m.id, slug: m.slug, name: m.name, price: String(m.price), status: m.status,
    score: m.score, totalCalls: m.totalCalls, failedCalls: m.failedCalls,
    bondAvailable: String(available), covered: m.status === "live" && available >= lockFor(m.price),
    arkivEntityKey: m.arkivEntityKey,
  };
}

export function publicRoutes(db: Db) {
  const app = new Hono();

  app.get("/config", (c) => c.json({
    network: env.network, usdc: env.usdc, gatewayAccount: env.gatewayId, vaultAccount: env.vaultId,
    hcsTopicId: env.hcsTopicId || null, hashscan: env.hashscan, facilitator: env.facilitatorUrl,
    features: { world: hasWorld(), arkiv: hasArkiv(), hcs: hasHcs(), demoMode: env.demoMode },
    feeBps: env.feeBps, penaltyBps: env.penaltyBps,
  }));

  app.get("/merchants", (c) => {
    const rows = db.select().from(merchants)
      .where(inArray(merchants.status, ["live", "paused", "needs_bond"])).orderBy(desc(merchants.totalCalls)).all();
    return c.json(rows.map(toPublicMerchant));
  });

  app.get("/receipts/:id", (c) => {
    const r = buildReceipt(db, c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "not_found" }, 404);
  });

  app.get("/receipts", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
    const rows = db.select({ id: payments.id }).from(payments).orderBy(desc(payments.createdAt)).limit(limit).all();
    return c.json(rows.map((r) => buildReceipt(db, r.id)).filter(Boolean));
  });

  app.get("/stats", (c) => {
    const row = db.select({
      calls: sql<number>`count(*)`,
      refunds: sql<number>`sum(case when ${payments.status} = 'refunded' then 1 else 0 end)`,
      refunded: sql<number>`coalesce(sum(case when ${payments.status} = 'refunded' then coalesce(${payments.refundAmount}, 0) else 0 end), 0)`,
    }).from(payments).get();
    const m = db.select({ n: sql<number>`count(*)` }).from(merchants).where(eq(merchants.status, "live")).get();
    const out: PublicStats = {
      protectedCalls: row?.calls ?? 0, refunds: row?.refunds ?? 0,
      usdcRefunded: String(row?.refunded ?? 0), merchants: m?.n ?? 0,
    };
    return c.json(out);
  });

  return app;
}
