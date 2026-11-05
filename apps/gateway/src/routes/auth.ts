import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { worldVerifySchema } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { env, hasWorld } from "../env.ts";
import { newId } from "../ids.ts";
import { clearSession, readSession, setSession } from "../auth.ts";

const { accounts, merchants } = schema;

export function authRoutes(db: Db) {
  const app = new Hono();

  app.get("/auth/config", (c) => c.json({
    world: hasWorld(), appId: env.worldAppId || null, environment: env.worldEnv, devLogin: env.demoMode && !hasWorld(),
  }));

  app.get("/world/rp-context", async (c) => {
    if (!hasWorld()) return c.json({ error: "world_not_configured" }, 503);
    const role = c.req.query("role");
    if (role !== "owner" && role !== "merchant") return c.json({ error: "bad_role" }, 400);
    const { createRpContext } = await import("../chain/world.ts");
    return c.json(createRpContext(role));
  });

  app.post("/world/verify", zValidator("json", worldVerifySchema), async (c) => {
    if (!hasWorld()) return c.json({ error: "world_not_configured" }, 503);
    const { role, idkitResponse } = c.req.valid("json");
    const { ACTIONS, verifyProof } = await import("../chain/world.ts");
    let proof: { nullifier: string; action: string };
    try {
      proof = await verifyProof(idkitResponse);
    } catch (err) {
      return c.json({ error: "verification_failed", detail: String(err) }, 401);
    }
    // A proof for one action must never create an account for another role.
    if (proof.action !== ACTIONS[role]) return c.json({ error: "action_mismatch" }, 401);
    return login(c, db, role, proof.action, proof.nullifier);
  });

  // Local development only: no World app configured. Never enabled when World is set up.
  app.post("/dev-login", zValidator("json", z.object({ role: z.enum(["owner", "merchant"]), name: z.string().min(1).max(40).default("demo") })), async (c) => {
    if (!env.demoMode || hasWorld()) return c.json({ error: "disabled" }, 403);
    const { role, name } = c.req.valid("json");
    return login(c, db, role, `dev-${role}`, `dev:${name}`);
  });

  app.get("/me", async (c) => {
    const s = await readSession(c);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    const acct = db.select().from(accounts).where(eq(accounts.id, s.sub)).get();
    if (!acct) return c.json({ error: "unauthorized" }, 401);
    const merchant = s.role === "merchant"
      ? db.select({ id: merchants.id, slug: merchants.slug, status: merchants.status }).from(merchants).where(eq(merchants.accountId, acct.id)).get()
      : null;
    return c.json({ id: acct.id, role: acct.role, createdAt: acct.createdAt, merchant: merchant ?? null });
  });

  app.post("/logout", (c) => { clearSession(c); return c.json({ ok: true }); });

  return app;
}

async function login(c: Parameters<typeof setSession>[0], db: Db, role: "owner" | "merchant", action: string, nullifier: string) {
  let acct = db.select().from(accounts).where(and(eq(accounts.worldNullifier, nullifier), eq(accounts.worldAction, action))).get();
  if (acct) {
    if (role === "merchant") {
      const m = db.select({ status: merchants.status }).from(merchants).where(eq(merchants.accountId, acct.id)).get();
      if (m?.status === "suspended") return c.json({ error: "suspended" }, 403);
    }
  } else {
    acct = { id: newId("acct"), role, worldAction: action, worldNullifier: nullifier, createdAt: Date.now() };
    db.insert(accounts).values(acct).run();
  }
  await setSession(c, { sub: acct.id, role: acct.role });
  return c.json({ id: acct.id, role: acct.role, isNew: acct.createdAt > Date.now() - 2000 });
}
