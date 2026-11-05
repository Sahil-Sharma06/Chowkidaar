/**
 * World ID Agent Pass: OpenID Connect (authorization code + PKCE S256) with step-up.
 * Used for owner sign-in and, with `max_age=0`, as the fresh human approval that
 * releases an agent payment above the owner's threshold.
 */
import { createHash, randomBytes } from "node:crypto";
import { verifyWithJwks, decode } from "hono/jwt";
import { env } from "../env.ts";

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

export type Purpose = "login" | "approval";
export interface PendingAuth { verifier: string; nonce: string; purpose: Purpose; approvalId?: string; ownerId?: string; createdAt: number }

// ponytail: in-memory state store, single gateway process; move to the DB if it ever scales out.
const pending = new Map<string, PendingAuth>();
const STATE_TTL_MS = 10 * 60 * 1000;
const b64url = (b: Buffer) => b.toString("base64url");

/** Builds the authorization URL. Approvals demand a fresh verification (`max_age=0`). */
export async function startAuth(p: { purpose: Purpose; approvalId?: string; ownerId?: string }): Promise<string> {
  const d = await discover();
  const { clientId, redirectUri } = cfg();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  for (const [k, v] of pending) if (Date.now() - v.createdAt > STATE_TTL_MS) pending.delete(k);
  pending.set(state, { verifier, nonce, purpose: p.purpose, approvalId: p.approvalId, ownerId: p.ownerId, createdAt: Date.now() });

  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256",
  });
  if (p.purpose === "approval") q.set("max_age", "0"); // step-up: a fresh verification for this transaction
  return `${d.authorization_endpoint}?${q}`;
}

export interface AuthResult { sub: string; iss: string; acr: string | null; amr: string[]; authTime: number; purpose: Purpose; approvalId?: string; ownerId?: string }

/** Redeems the code once and validates the ID token (signature, iss, aud, nonce, freshness). */
export async function finishAuth(params: { code?: string; state?: string; error?: string; error_description?: string }): Promise<AuthResult> {
  const p = params.state ? pending.get(params.state) : undefined;
  if (params.state) pending.delete(params.state); // one attempt per state, whatever happens
  if (params.error) throw Object.assign(new Error(params.error), { purpose: p?.purpose, approvalId: p?.approvalId, detail: params.error_description });
  if (!p) throw new Error("state_unknown_or_expired");
  if (Date.now() - p.createdAt > STATE_TTL_MS) throw Object.assign(new Error("expired"), { purpose: p.purpose, approvalId: p.approvalId });
  if (!params.code) throw Object.assign(new Error("missing_code"), { purpose: p.purpose, approvalId: p.approvalId });

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
  if (!res.ok) throw Object.assign(new Error(`token_exchange_${res.status}`), { purpose: p.purpose, approvalId: p.approvalId, detail: (await res.text()).slice(0, 300) });
  const tok = (await res.json()) as { id_token?: string };
  if (!tok.id_token) throw Object.assign(new Error("no_id_token"), { purpose: p.purpose, approvalId: p.approvalId });

  const { header } = decode(tok.id_token);
  const claims = await verifyWithJwks(tok.id_token, {
    jwks_uri: d.jwks_uri,
    allowedAlgorithms: [(header.alg as "RS256") ?? "RS256"],
    verification: { iss: d.issuer, aud: clientId },
  }) as Record<string, unknown>;

  if (claims.nonce !== p.nonce) throw Object.assign(new Error("nonce_mismatch"), { purpose: p.purpose, approvalId: p.approvalId });
  const authTime = Number(claims.auth_time ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (authTime > now + 60) throw Object.assign(new Error("auth_time_in_future"), { purpose: p.purpose, approvalId: p.approvalId });
  // max_age=0: the verification must belong to this attempt, so it cannot predate the attempt (with clock tolerance).
  if (p.purpose === "approval" && authTime < Math.floor(p.createdAt / 1000) - 60) {
    throw Object.assign(new Error("stale_authentication"), { purpose: p.purpose, approvalId: p.approvalId });
  }
  return {
    sub: String(claims.sub), iss: String(claims.iss), acr: claims.acr ? String(claims.acr) : null,
    amr: Array.isArray(claims.amr) ? claims.amr.map(String) : [], authTime,
    purpose: p.purpose, approvalId: p.approvalId, ownerId: p.ownerId,
  };
}

export const webRedirect = (path: string, q: Record<string, string>) => `${env.webOrigin}${path}?${new URLSearchParams(q)}`;
