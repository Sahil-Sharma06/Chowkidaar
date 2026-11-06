import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { devLoginSchema, enableRoleSchema, patchMeSchema, worldVerifySchema } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { env, hasWorld } from "../env.ts";
import { newId } from "../ids.ts";
import { clearSession, createSession, readSession, requireAuth, type Session } from "../auth.ts";
import { hasAgentPass, safeNext, type AuthError } from "../chain/agentpass.ts";

const { accounts, merchants, approvals, agents, sessions } = schema;
export const AGENT_PASS_ACTION = "agent-pass-oidc";
export const DEV_ACTION = "dev";

/** Scopes a step-up can authorize. Each maps to exactly one kind of sensitive action. */
const STEP_UP_SCOPE = /^(agent:[A-Za-z0-9_-]{1,64}:(limits|key)|merchant:[A-Za-z0-9_-]{1,64}:withdraw)$/;

type Vars = { Variables: { session: Session } };

/**
 * Dev login: automatic when Agent Pass is not configured. DEV_LOGIN=true also allows it next to
 * Agent Pass for local testing, but never in a production build.
 */
export const devLoginEnabled = () =>
  env.demoMode && process.env.NODE_ENV !== "production" && (!hasAgentPass() || process.env.DEV_LOGIN === "true");

export function authRoutes(db: Db) {
  const app = new Hono<Vars>();

  app.get("/auth/config", (c) => c.json({
    agentPass: hasAgentPass(),
    idkit: hasWorld(),
    appId: env.worldAppId || null,
    environment: env.worldEnv,
    devLogin: devLoginEnabled(),
  }));

  // --- World ID Agent Pass (OIDC) ----------------------------------------------------
  app.get("/world/oidc/start", async (c) => {
    if (!hasAgentPass()) return c.json({ error: "agent_pass_not_configured" }, 503);
    const { startAuth } = await import("../chain/agentpass.ts");
    const purpose = c.req.query("purpose") ?? "login";
    const next = safeNext(c.req.query("next"));

    if (purpose === "login") return c.redirect(await startAuth(db, "login", { next }));

    // Approval and step-up both act for the signed-in person, so they need a session.
    const s = readSession(c, db);
    if (!s) return c.redirect(web("/login", { next: next || "/owner" }));

    if (purpose === "approval") {
      if (!s.isOwner) return c.redirect(web("/onboarding", {}));
      const approvalId = c.req.query("approvalId") ?? "";
      const a = db.select({ approval: approvals, ownerId: agents.ownerId }).from(approvals)
        .innerJoin(agents, eq(agents.id, approvals.agentId)).where(eq(approvals.id, approvalId)).get();
      if (!a || a.ownerId !== s.sub) return c.redirect(web("/owner/approvals", { world: "denied", reason: "not_found" }));
      if (a.approval.status !== "pending" || a.approval.expiresAt < Date.now()) {
        return c.redirect(web("/owner/approvals", { world: "denied", reason: "approval_expired" }));
      }
      return c.redirect(await startAuth(db, "approval", { approvalId, accountId: s.sub, sessionId: s.id }));
    }

    if (purpose === "stepup") {
      const scope = c.req.query("scope") ?? "";
      if (!STEP_UP_SCOPE.test(scope)) return c.json({ error: "bad_scope" }, 400);
      return c.redirect(await startAuth(db, "stepup", { scope, accountId: s.sub, sessionId: s.id, next: next || "/owner" }));
    }
    return c.json({ error: "bad_purpose" }, 400);
  });

  app.get("/world/oidc/callback", async (c) => {
    const { finishAuth } = await import("../chain/agentpass.ts");
    let r: Awaited<ReturnType<typeof finishAuth>>;
    try {
      r = await finishAuth(db, c.req.query());
    } catch (err) {
      // Denied, cancelled, expired or invalid: the protected action does not happen.
      const e = err as AuthError;
      console.warn("[agent-pass] failed:", e.message, e.detail ?? "");
      const reason = e.message;
      if (e.purpose === "approval") return c.redirect(web("/owner/approvals", { world: "denied", reason }));
      if (e.purpose === "stepup") return c.redirect(web(safeNext(e.payload?.next) || "/owner", { stepup: "denied", reason }));
      return c.redirect(web("/login", { world: "denied", reason, ...(e.payload?.next ? { next: e.payload.next } : {}) }));
    }
    const identity = `${r.iss}|${r.sub}`;

    if (r.purpose === "login") {
      let acct = db.select().from(accounts)
        .where(and(eq(accounts.worldNullifier, identity), eq(accounts.worldAction, AGENT_PASS_ACTION))).get();
      if (!acct) {
        acct = { ...blankAccount(), worldAction: AGENT_PASS_ACTION, worldNullifier: identity };
        db.insert(accounts).values(acct).run();
      }
      db.update(accounts).set({ lastLoginAt: Date.now() }).where(eq(accounts.id, acct.id)).run();
      await createSession(c, db, acct.id);
      return c.redirect(web(safeNext(r.payload.next) || homeFor(acct), {}));
    }

    // Approval and step-up: the human who just verified must be the account that asked.
    const acct = db.select().from(accounts).where(eq(accounts.id, r.payload.accountId ?? "")).get();
    const same = acct && acct.worldAction === AGENT_PASS_ACTION && acct.worldNullifier === identity;

    if (r.purpose === "approval") {
      if (!same) return c.redirect(web("/owner/approvals", { world: "denied", reason: "identity_mismatch" }));
      // The session that started the approval must still be live (not signed out or revoked meanwhile).
      const live = db.select({ id: sessions.id }).from(sessions)
        .where(and(eq(sessions.id, r.payload.sessionId ?? ""), eq(sessions.accountId, acct.id), isNull(sessions.revokedAt))).get();
      if (!live) return c.redirect(web("/owner/approvals", { world: "denied", reason: "session_ended" }));
      // Recheck ownership and status at execution time, then approve exactly once.
      const row = db.select({ approval: approvals, ownerId: agents.ownerId }).from(approvals)
        .innerJoin(agents, eq(agents.id, approvals.agentId)).where(eq(approvals.id, r.payload.approvalId ?? "")).get();
      const a = row?.ownerId === acct.id ? row.approval : undefined;
      if (!a || a.status !== "pending" || a.expiresAt < Date.now()) {
        return c.redirect(web("/owner/approvals", { world: "denied", reason: "approval_expired" }));
      }
      const done = db.update(approvals).set({ status: "approved" })
        .where(and(eq(approvals.id, a.id), eq(approvals.status, "pending"))).run();
      if (done.changes !== 1) return c.redirect(web("/owner/approvals", { world: "denied", reason: "approval_expired" }));
      console.log(`[agent-pass] approval ${a.id} granted acr=${r.acr} amr=${r.amr.join(",")} auth_time=${r.authTime}`);
      return c.redirect(web("/owner/approvals", { world: "approved", approvalId: a.id }));
    }

    // stepup
    const next = safeNext(r.payload.next) || "/owner";
    if (!same) return c.redirect(web(next, { stepup: "denied", reason: "identity_mismatch" }));
    const updated = db.update(sessions).set({ stepUpScope: r.payload.scope, stepUpAt: Date.now() })
      .where(and(eq(sessions.id, r.payload.sessionId ?? ""), eq(sessions.accountId, acct.id), isNull(sessions.revokedAt))).run();
    if (updated.changes !== 1) return c.redirect(web(next, { stepup: "denied", reason: "session_ended" }));
    return c.redirect(web(next, { stepup: "ok", scope: r.payload.scope ?? "" }));
  });

  // --- IDKit: proof of human to become a merchant ------------------------------------
  app.get("/world/rp-context", requireAuth(db), async (c) => {
    if (!hasWorld()) return c.json({ error: "world_not_configured" }, 503);
    const { createRpContext } = await import("../chain/world.ts");
    return c.json(createRpContext());
  });

  app.post("/world/verify", requireAuth(db), zValidator("json", worldVerifySchema), async (c) => {
    if (!hasWorld()) return c.json({ error: "world_not_configured" }, 503);
    const s = c.get("session");
    const { idkitResponse } = c.req.valid("json");
    const { MERCHANT_ACTION, verifyProof } = await import("../chain/world.ts");
    let proof: { nullifier: string; action: string };
    try {
      proof = await verifyProof(idkitResponse);
    } catch (err) {
      return c.json({ error: "verification_failed", detail: String(err) }, 401);
    }
    if (proof.action !== MERCHANT_ACTION) return c.json({ error: "action_mismatch" }, 401);
    const acct = db.select().from(accounts).where(eq(accounts.id, s.sub)).get()!;
    if (acct.merchantNullifier && acct.merchantNullifier !== proof.nullifier) return c.json({ error: "identity_mismatch" }, 409);
    // One human, one merchant: this proof may already belong to another account (e.g. a banned merchant).
    const other = db.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.merchantNullifier, proof.nullifier), ne(accounts.id, acct.id))).get();
    if (other) return c.json({ error: "human_already_registered" }, 409);
    db.update(accounts).set({ merchantNullifier: proof.nullifier, merchantVerifiedAt: Date.now(), isMerchant: true })
      .where(eq(accounts.id, acct.id)).run();
    return c.json(meView(db, acct.id));
  });

  // --- Local development login (only when Agent Pass is not configured) --------------
  app.post("/dev-login", zValidator("json", devLoginSchema), async (c) => {
    if (!devLoginEnabled()) return c.json({ error: "disabled" }, 403);
    const { name } = c.req.valid("json");
    const nullifier = `dev:${name.toLowerCase()}`;
    let acct = db.select().from(accounts).where(and(eq(accounts.worldNullifier, nullifier), eq(accounts.worldAction, DEV_ACTION))).get();
    if (!acct) {
      acct = { ...blankAccount(), worldAction: DEV_ACTION, worldNullifier: nullifier, displayName: name };
      db.insert(accounts).values(acct).run();
    }
    db.update(accounts).set({ lastLoginAt: Date.now() }).where(eq(accounts.id, acct.id)).run();
    await createSession(c, db, acct.id);
    return c.json({ ...meView(db, acct.id), next: homeFor(acct) });
  });

  // --- Current account -----------------------------------------------------------------
  app.get("/me", requireAuth(db), (c) => c.json(meView(db, c.get("session").sub)));

  app.patch("/me", requireAuth(db), zValidator("json", patchMeSchema), (c) => {
    db.update(accounts).set({ displayName: c.req.valid("json").displayName }).where(eq(accounts.id, c.get("session").sub)).run();
    return c.json(meView(db, c.get("session").sub));
  });

  /** Turn on a role. Owner is free; merchant needs an IDKit proof of human (unless World is not set up in dev). */
  app.post("/me/roles", requireAuth(db), zValidator("json", enableRoleSchema), (c) => {
    const s = c.get("session");
    const { role } = c.req.valid("json");
    if (role === "owner") {
      db.update(accounts).set({ isOwner: true }).where(eq(accounts.id, s.sub)).run();
    } else {
      const acct = db.select().from(accounts).where(eq(accounts.id, s.sub)).get()!;
      if (!acct.merchantVerifiedAt) {
        if (hasWorld() || !env.demoMode) return c.json({ error: "verification_required" }, 403);
      }
      db.update(accounts).set({ isMerchant: true }).where(eq(accounts.id, s.sub)).run();
    }
    return c.json(meView(db, s.sub));
  });

  app.get("/me/sessions", requireAuth(db), (c) => {
    const s = c.get("session");
    const rows = db.select({ id: sessions.id, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
      .from(sessions).where(and(eq(sessions.accountId, s.sub), isNull(sessions.revokedAt), gt(sessions.expiresAt, Date.now())))
      .orderBy(desc(sessions.lastSeenAt)).all();
    return c.json(rows.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === s.id })));
  });

  app.post("/logout", (c) => { clearSession(c, db, { all: c.req.query("all") === "1" }); return c.json({ ok: true }); });

  return app;
}

function blankAccount() {
  return {
    id: newId("acct"), displayName: null as string | null, isOwner: false, isMerchant: false,
    merchantNullifier: null as string | null, merchantVerifiedAt: null as number | null, lastLoginAt: null as number | null, createdAt: Date.now(),
  };
}

function homeFor(a: { isOwner: boolean; isMerchant: boolean }) {
  return a.isOwner ? "/owner" : a.isMerchant ? "/merchant" : "/onboarding";
}

function web(path: string, q: Record<string, string>) {
  const qs = new URLSearchParams(q).toString();
  return `${env.webOrigin}${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;
}

export function meView(db: Db, accountId: string) {
  const a = db.select().from(accounts).where(eq(accounts.id, accountId)).get()!;
  const merchant = db.select({ id: merchants.id, slug: merchants.slug, name: merchants.name, status: merchants.status })
    .from(merchants).where(eq(merchants.accountId, a.id)).get() ?? null;
  const agentCount = db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, a.id)).all().length;
  return {
    id: a.id,
    displayName: a.displayName,
    identity: a.worldAction === AGENT_PASS_ACTION ? "world-id" : "dev",
    roles: { owner: a.isOwner, merchant: a.isMerchant },
    merchantVerified: Boolean(a.merchantVerifiedAt),
    merchant,
    agentCount,
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt,
  };
}

export type MeView = ReturnType<typeof meView>;
