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
    const code = (body as { error?: string })?.error ?? `http_${res.status}`;
    throw new ApiError(res.status, code, body);
  }
  return body as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, data?: unknown) => api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const put = <T,>(path: string, data: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(data) });

export const HASHSCAN = process.env.NEXT_PUBLIC_HASHSCAN_URL ?? "https://hashscan.io/testnet";
export const USDC_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID ?? "0.0.429274";
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4000";

export type Me = { id: string; role: "owner" | "merchant"; merchant: { id: string; slug: string; status: string } | null };
export type Config = {
  network: string; usdc: string; gatewayAccount: string; vaultAccount: string; hcsTopicId: string | null; hashscan: string; facilitator: string;
  features: { world: boolean; arkiv: boolean; hcs: boolean; demoMode: boolean }; feeBps: number; penaltyBps: number;
};
export type AgentRow = {
  id: string; name: string; hederaAccountId: string; perCallCap: number; dailyCap: number; approvalThreshold: number; minScore: number;
  allowlistOnly: boolean; status: "active" | "paused"; createdAt: number; spentToday: number; allowedMerchantIds: string[]; lastPaymentAt: number | null; apiKey?: string;
};
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
  responseSchema: Record<string, unknown>; status: string; bondBalance: number; bondLocked: number; totalCalls: number; failedCalls: number;
  score: number | null; arkivEntityKey: string | null; bond: Bond; total: string;
};
