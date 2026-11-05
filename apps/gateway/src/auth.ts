import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import { env } from "./env.ts";
import { sha256 } from "./ids.ts";
import { hasAgentPass } from "./chain/agentpass.ts";

const { sessions, accounts } = schema;

export const COOKIE = "app_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A step-up verification authorizes one sensitive action, and only shortly after it happened. */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 60 * 1000;

export type Session = {
  id: string; // session row id (hash of the cookie token)
  sub: string; // account id
  isOwner: boolean;
  isMerchant: boolean;
  stepUpScope: string | null;
  stepUpAt: number | null;
};

const secureCookie = () => env.webOrigin.startsWith("https") || env.publicUrl.startsWith("https");

export async function createSession(c: Context, db: Db, accountId: string) {
  const token = randomBytes(32).toString("base64url");
  const t = Date.now();
  db.insert(sessions).values({
    id: sha256(token), accountId, userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    createdAt: t, lastSeenAt: t, expiresAt: t + SESSION_TTL_MS,
  }).run();
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: "Lax", path: "/", secure: secureCookie(), maxAge: SESSION_TTL_MS / 1000,
  });
}

export function readSession(c: Context, db: Db): Session | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const t = Date.now();
  const row = db.select({ s: sessions, a: accounts }).from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(and(eq(sessions.id, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, t)))
    .get();
  if (!row) return null;
  if (t - row.s.lastSeenAt > TOUCH_EVERY_MS) {
    // Sliding expiry: an active user stays signed in, an idle one is logged out after the TTL.
    db.update(sessions).set({ lastSeenAt: t, expiresAt: t + SESSION_TTL_MS }).where(eq(sessions.id, row.s.id)).run();
  }
  return {
    id: row.s.id, sub: row.a.id, isOwner: row.a.isOwner, isMerchant: row.a.isMerchant,
    stepUpScope: row.s.stepUpScope, stepUpAt: row.s.stepUpAt,
  };
}

export function clearSession(c: Context, db: Db, opts: { all?: boolean } = {}) {
  const s = readSession(c, db);
  if (s) {
    const where = opts.all ? and(eq(sessions.accountId, s.sub), isNull(sessions.revokedAt)) : eq(sessions.id, s.id);
    db.update(sessions).set({ revokedAt: Date.now() }).where(where).run();
  }
  deleteCookie(c, COOKIE, { path: "/" });
}

export function requireAuth(db: Db) {
  return async (c: Context, next: Next) => {
    const s = readSession(c, db);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    c.set("session", s);
    await next();
  };
}

/** The account must have the role enabled. One account can hold both roles. */
export function requireRole(db: Db, role: "owner" | "merchant") {
  return async (c: Context, next: Next) => {
    const s = readSession(c, db);
    if (!s) return c.json({ error: "unauthorized" }, 401);
    if (role === "owner" ? !s.isOwner : !s.isMerchant) return c.json({ error: "role_required", role }, 403);
    c.set("session", s);
    await next();
  };
}

/**
 * Consumes a fresh Agent Pass step-up for `scope`. Returns false when the action must not run.
 * Without Agent Pass configured (local dev), sensitive actions are allowed and nothing is consumed.
 */
export function consumeStepUp(db: Db, s: Session, scope: string): boolean {
  if (!hasAgentPass()) return true;
  if (s.stepUpScope !== scope || !s.stepUpAt || Date.now() - s.stepUpAt > STEP_UP_TTL_MS) return false;
  // Single use: clear only if still the same grant, so two concurrent requests cannot both spend it.
  const r = db.update(sessions).set({ stepUpScope: null, stepUpAt: null })
    .where(and(eq(sessions.id, s.id), eq(sessions.stepUpScope, scope), eq(sessions.stepUpAt, s.stepUpAt))).run();
  return r.changes === 1;
}

export const stepUpRequired = (c: Context, scope: string) =>
  c.json({ error: "step_up_required", scope }, 403);
