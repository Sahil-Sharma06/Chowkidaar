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

const { accounts, merchants, approvals, agents } = schema;
export const AGENT_PASS_ACTION = "agent-pass-oidc";

export function authRoutes(db: Db) {
  const app = new Hono();

  app.get("/auth/config", async (c) => {
    const { hasAgentPass } = await import("../chain/agentpass.ts");
    return c.json({
      world: hasWorld(), appId: env.worldAppId || null, environment: env.worldEnv, devLogin: env.demoMode && !hasWorld(),
      agentPass: hasAgentPass(),
    });
  });

  // --- World ID Agent Pass (OIDC) ----------------------------------------------------
  app.get("/world/oidc/start", async (c) => {
    const { hasAgentPass, startAuth } = await import("../chain/agentpass.ts");
    if (!hasAgentPass()) return c.json({ error: "agent_pass_not_configured" }, 503);
    const purpose = c.req.query("purpose") === "approval" ? "approval" : "login";
    if (purpose === "login") return c.redirect(await startAuth({ purpose }));
    // Approval: only the owner of the agent may approve, and only a pending, unexpired approval.
    const s = await readSession(c);
    if (!s || s.role !== "owner") return c.json({ error: "unauthorized" }, 401);
    const approvalId = c.req.query("approvalId") ?? "";
    const a = db.select({ approval: approvals, ownerId: agents.ownerId }).from(approvals)
      .innerJoin(agents, eq(agents.id, approvals.agentId)).where(eq(approvals.id, approvalId)).get();
    if (!a || a.ownerId !== s.sub) return c.json({ error: "not_found" }, 404);
    if (a.approval.status !== "pending" || a.approval.expiresAt < Date.now()) return c.json({ error: "not_pending" }, 409);
    return c.redirect(await startAuth({ purpose: "approval", approvalId, ownerId: s.sub }));
  });

  app.get("/world/oidc/callback", async (c) => {
    const { finishAuth, webRedirect } = await import("../chain/agentpass.ts");
    const q = c.req.query();
    let r: Awaited<ReturnType<typeof finishAuth>>;
    try {
      r = await finishAuth(q);
    } catch (err) {
      // Denied, cancelled, expired or invalid: the protected action does not happen.
      const e = err as Error & { purpose?: string; approvalId?: string; detail?: string };
      console.warn("[agent-pass] failed:", e.message, e.detail ?? "");
      const path = e.purpose === "approval" ? "/owner/approvals" : "/login";
      return c.redirect(webRedirect(path, { world: "denied", reason: e.message }));
    }
    const nullifier = `${r.iss}|${r.sub}`;
    if (r.purpose === "login") {
      return login(c, db, "owner", AGENT_PASS_ACTION, nullifier, "/owner");
    }
    // Approval: the verified human must be the owner who started it (or link on first use).
    const acct = db.select().from(accounts).where(eq(accounts.id, r.ownerId ?? "")).get();
    if (!acct) return c.redirect(webRedirect("/owner/approvals", { world: "denied", reason: "owner_missing" }));
    const linked = db.select().from(accounts).where(and(eq(accounts.worldNullifier, nullifier), eq(accounts.worldAction, AGENT_PASS_ACTION))).get();
    if (linked && linked.id !== acct.id) return c.redirect(webRedirect("/owner/approvals", { world: "denied", reason: "identity_mismatch" }));
    if (!linked && acct.worldAction !== AGENT_PASS_ACTION) {
      // Dev-login / IDKit owner approving for the first time: bind this World ID to the account.
      db.update(accounts).set({ worldAction: AGENT_PASS_ACTION, worldNullifier: nullifier }).where(eq(accounts.id, acct.id)).run();
    } else if (!linked) {
      return c.redirect(webRedirect("/owner/approvals", { world: "denied", reason: "identity_mismatch" }));
    }
    const a = db.select().from(approvals).where(eq(approvals.id, r.approvalId ?? "")).get();
    if (!a || a.status !== "pending" || a.expiresAt < Date.now()) return c.redirect(webRedirect("/owner/approvals", { world: "denied", reason: "approval_expired" }));
    db.update(approvals).set({ status: "approved" }).where(eq(approvals.id, a.id)).run();
    console.log(`[agent-pass] approval ${a.id} granted by ${r.sub.slice(0, 8)}… acr=${r.acr} amr=${r.amr.join(",")} auth_time=${r.authTime}`);
    return c.redirect(webRedirect("/owner/approvals", { world: "approved", approvalId: a.id }));
  });

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

async function login(c: Parameters<typeof setSession>[0], db: Db, role: "owner" | "merchant", action: string, nullifier: string, redirectTo?: string) {
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
  if (redirectTo) return c.redirect(`${env.webOrigin}${redirectTo}`);
  return c.json({ id: acct.id, role: acct.role, isNew: acct.createdAt > Date.now() - 2000 });
}
