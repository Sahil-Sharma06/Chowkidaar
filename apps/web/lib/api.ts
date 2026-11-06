export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: unknown) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const raw = (body as { error?: unknown })?.error;
    const code = typeof raw === "string" ? raw : `http_${res.status}`;
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, data?: unknown) => api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const put = <T,>(path: string, data: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(data) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

/** Recurring protected calls to one merchant, each run pre-paid by a Hedera Scheduled Transaction. */
export type SubscriptionRow = {
  id: string; agentId: string; merchantId: string; merchantName: string; merchantSlug: string; amount: number; everySec: number; body: string;
  status: "active" | "cancelled"; createdAt: number;
  runs: { scheduleId: string; n: number; executeAt: number; status: "scheduled" | "done" | "failed" | "cancelled"; paymentId: string | null; error: string | null; paymentStatus: string | null }[];
};

export const HASHSCAN = process.env.NEXT_PUBLIC_HASHSCAN_URL ?? "https://hashscan.io/testnet";
export const USDC_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? "0.0.429274";
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";
export const MIRROR_URL = process.env.NEXT_PUBLIC_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

export type Role = "owner" | "merchant";
export type Me = {
  id: string; displayName: string | null; identity: "world-id" | "dev";
  roles: Record<Role, boolean>; merchantVerified: boolean;
  merchant: { id: string; slug: string; name: string; status: string } | null;
  agentCount: number; createdAt: number; lastLoginAt: number | null;
};
export type AuthConfig = { agentPass: boolean; idkit: boolean; appId: string | null; environment: string; devLogin: boolean };

export const loginUrl = (next?: string) => `/api/world/oidc/start?purpose=login${next ? `&next=${encodeURIComponent(next)}` : ""}`;

/**
 * Step-up: a sensitive action answered 403 step_up_required. Remember what we were doing,
 * send the person through a fresh World ID check, and come back to `next` to finish it.
 */
const PENDING_KEY = "pending-step-up";
export function startStepUp(scope: string, next: string, pending: unknown) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ scope, pending, at: Date.now() })); } catch { /* storage blocked: the user re-submits */ }
  window.location.href = `/api/world/oidc/start?purpose=stepup&scope=${encodeURIComponent(scope)}&next=${encodeURIComponent(next)}`;
}
/** Returns the remembered action for `scope` once (and forgets it), if it is recent. */
export function takePendingStepUp<T>(scope: string): T | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { scope: string; pending: T; at: number };
    if (p.scope !== scope) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return Date.now() - p.at < 10 * 60 * 1000 ? p.pending : null;
  } catch { return null; }
}
export const isStepUp = (e: unknown): e is ApiError & { body: { scope: string } } =>
  e instanceof ApiError && e.code === "step_up_required" && typeof (e.body as { scope?: unknown })?.scope === "string";
export type Config = {
  network: string; usdc: string; gatewayAccount: string; vaultAccount: string; hcsTopicId: string | null; hashscan: string; facilitator: string;
  features: { world: boolean; arkiv: boolean; hcs: boolean; demoMode: boolean }; feeBps: number; penaltyBps: number;
};
export type AgentRow = {
  id: string; name: string; hederaAccountId: string; custodial: boolean; perCallCap: number; dailyCap: number; approvalThreshold: number; minScore: number;
  allowlistOnly: boolean; status: "active" | "paused"; createdAt: number; spentToday: number; allowedMerchantIds: string[]; lastPaymentAt: number | null; apiKey?: string;
  /** HCS-14 Universal Agent ID, and the HCS message that announced it. */
  uaid: string | null; uaidSeq: number | null;
  /** Top-ups queued as Hedera Scheduled Transactions, oldest first. */
  scheduledFunding: ScheduledTopUp[];
  /** Per-merchant daily limits (on allowlist rows), with what that merchant has taken today. */
  merchantCaps: Record<string, { dailyCap: number; spentToday: number }>;
};
export type ScheduledTopUp = { scheduleId: string; amount: number; executeAt: number };
export type ApprovalRow = {
  id: string; agentId: string; merchantId: string; amount: number; status: string; expiresAt: number; createdAt: number;
  agentName: string; merchantName: string; merchantSlug: string; merchantScore: number | null;
};
export type Bond = {
  vaultAccount: string; token: string; memo: string; balance: string; locked: string; available: string; minimum: string; perFailure: string;
  failuresCovered: number; covered: boolean; ledger?: { id: string; type: string; amount: number; txId: string | null; paymentId: string | null; createdAt: number }[];
};
export type MerchantMe = {
  id: string; slug: string; name: string; endpointUrl: string; payoutAccountId: string; price: number; timeoutMs: number;
  responseSchema: Record<string, unknown>; category: string; keywords: string[]; description: string | null; samplePrompt: string | null;
  status: string; bondBalance: number; bondLocked: number; totalCalls: number; failedCalls: number;
  score: number | null; arkivEntityKey: string | null; bond: Bond; total: string;
};
