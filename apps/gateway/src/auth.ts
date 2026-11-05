import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { env } from "./env.ts";

export const COOKIE = "app_session";
export type Session = { sub: string; role: "owner" | "merchant" };

export async function setSession(c: Context, s: Session) {
  const token = await sign({ ...s, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, env.jwtSecret);
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", secure: env.publicUrl.startsWith("https") });
}

export function clearSession(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function readSession(c: Context): Promise<Session | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  try {
    const p = (await verify(token, env.jwtSecret, "HS256")) as unknown as Session;
    return p?.sub ? { sub: p.sub, role: p.role } : null;
  } catch {
    return null;
  }
}

export function requireRole(role: "owner" | "merchant") {
  return async (c: Context, next: Next) => {
    const s = await readSession(c);
    if (!s || s.role !== role) return c.json({ error: "unauthorized" }, 401);
    c.set("session", s);
    await next();
  };
}
