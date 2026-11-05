/**
 * World ID Agent Pass: OpenID Connect (authorization code + PKCE S256) with step-up.
 * Used for owner sign-in and, with `max_age=0`, as the fresh human approval that
 * releases an agent payment above the owner's threshold.
 */
import { createHash, randomBytes } from "node:crypto";
import { verifyWithJwks, decode } from "hono/jwt";
import { eq, lt } from "drizzle-orm";
import { env } from "../env.ts";
import type { Db } from "../db/index.ts";
import * as schema from "../db/schema.ts";

export const ISSUER = process.env.WORLD_OIDC_ISSUER || "https://auth.world.org";
export const hasAgentPass = () => Boolean(process.env.WORLD_OIDC_CLIENT_ID && process.env.WORLD_OIDC_CLIENT_SECRET && process.env.WORLD_OIDC_REDIRECT_URI);

const cfg = () => ({
  clientId: process.env.WORLD_OIDC_CLIENT_ID!,
  clientSecret: process.env.WORLD_OIDC_CLIENT_SECRET!,
  redirectUri: process.env.WORLD_OIDC_REDIRECT_URI!,
});

type Discovery = { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; issuer: string };
let discovery: Discovery | null = null;
async function discover(): Promise<Discovery> {
  if (discovery) return discovery;
  const res = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`oidc_discovery_${res.status}`);
  discovery = (await res.json()) as Discovery;
  return discovery;
}

/** login: sign up or sign in. approval: release one agent payment. stepup: authorize one sensitive action. */
export type Purpose = "login" | "approval" | "stepup";
/** Context carried through the redirect: approvalId, accountId, sessionId, scope, next. */
export type AuthPayload = Record<string, string>;

const STATE_TTL_MS = 10 * 60 * 1000;
/** Verification classes we accept: Selfie Check (anyone with a phone) or Orb. Face Auth variants are stricter forms of these. */
export const ACCEPTED_ACR = [
  "https://world.org/oidc/acr/selfie", "https://world.org/oidc/acr/orb",
  "https://world.org/oidc/acr/selfie-face", "https://world.org/oidc/acr/orb-face",
];
const b64url = (b: Buffer) => b.toString("base64url");
const { oidcStates } = schema;

/** Builds the authorization URL. Approvals and step-ups demand a fresh verification (`max_age=0`). */
export async function startAuth(db: Db, purpose: Purpose, payload: AuthPayload = {}): Promise<string> {
  const d = await discover();
  const { clientId, redirectUri } = cfg();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  db.delete(oidcStates).where(lt(oidcStates.createdAt, Date.now() - STATE_TTL_MS)).run();
  db.insert(oidcStates).values({ state, verifier, nonce, purpose, payload, createdAt: Date.now() }).run();

  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256",
  });
  // Ask explicitly for Selfie Check or Orb (alternatives: one is enough), so people without Orb access can sign in.
  q.set("claims", JSON.stringify({ id_token: { acr: { essential: true, values: ACCEPTED_ACR } } }));
  if (purpose !== "login") q.set("max_age", "0"); // step-up: a fresh verification for this action
  return `${d.authorization_endpoint}?${q}`;
}

export interface AuthResult { sub: string; iss: string; acr: string | null; amr: string[]; authTime: number; purpose: Purpose; payload: AuthPayload }
export type AuthError = Error & { purpose?: Purpose; payload?: AuthPayload; detail?: string };

/** Redeems the code once and validates the ID token (signature, iss, aud, nonce, freshness). */
export async function finishAuth(db: Db, params: { code?: string; state?: string; error?: string; error_description?: string }): Promise<AuthResult> {
  const p = params.state ? db.select().from(oidcStates).where(eq(oidcStates.state, params.state)).get() : undefined;
  if (params.state) db.delete(oidcStates).where(eq(oidcStates.state, params.state)).run(); // one attempt per state
  const fail = (code: string, detail?: string): AuthError => Object.assign(new Error(code), { purpose: p?.purpose, payload: p?.payload, detail });
  if (params.error) throw fail(params.error, params.error_description);
  if (!p) throw fail("state_unknown_or_expired");
  if (Date.now() - p.createdAt > STATE_TTL_MS) throw fail("expired");
  if (!params.code) throw fail("missing_code");

  const d = await discover();
  const { clientId, clientSecret, redirectUri } = cfg();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, // client_secret_basic
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: redirectUri, code_verifier: p.verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw fail(`token_exchange_${res.status}`, (await res.text()).slice(0, 300));
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) throw fail("no_id_token");

  let claims: Record<string, unknown>;
  try {
    const { header } = decode(tok.id_token);
    claims = await verifyWithJwks(tok.id_token, {
      jwks_uri: d.jwks_uri,
      // Pin the algorithm family: never let the token pick "none" or an HMAC alg.
      allowedAlgorithms: [header.alg === "ES256" ? "ES256" : "RS256"],
      verification: { iss: d.issuer, aud: clientId },
    }) as Record<string, unknown>;
  } catch (err) {
    throw fail("invalid_id_token", String(err));
  }

  if (claims.nonce !== p.nonce) throw fail("nonce_mismatch");
  // The token must prove one of the classes we asked for; an unverified account carries no acr.
  if (!ACCEPTED_ACR.includes(String(claims.acr ?? ""))) throw fail("verification_level_too_low", String(claims.acr ?? "none"));
  const authTime = Number(claims.auth_time ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (authTime > now + 60) throw fail("auth_time_in_future");
  // max_age=0: the verification must belong to this attempt, so it cannot predate the attempt (with clock tolerance).
  if (p.purpose !== "login" && authTime < Math.floor(p.createdAt / 1000) - 60) throw fail("stale_authentication");
  return {
    sub: String(claims.sub), iss: String(claims.iss), acr: claims.acr ? String(claims.acr) : null,
    amr: Array.isArray(claims.amr) ? claims.amr.map(String) : [], authTime,
    purpose: p.purpose, payload: p.payload,
  };
}

/** Only same-site relative paths are allowed as a post-login destination (no open redirect). */
export const safeNext = (next: string | undefined | null) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "";

export const webRedirect = (path: string, q: Record<string, string>) => `${env.webOrigin}${path}?${new URLSearchParams(q)}`;
