import { signRequest } from "@worldcoin/idkit-core/signing";
import { env } from "../env.ts";

// Never rename these: a new action name produces new nullifiers and lets banned merchants re-register.
export const ACTIONS = { merchant: "merchant-register-v1", owner: "owner-login-v1" } as const;
export type Role = keyof typeof ACTIONS;

export function createRpContext(role: Role) {
  const action = ACTIONS[role];
  const { sig, nonce, createdAt, expiresAt } = signRequest({ signingKeyHex: env.worldSigningKey, action });
  // The widget expects snake_case.
  return {
    action,
    rp_context: { rp_id: env.worldRpId, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
  };
}

export async function verifyProof(idkitResponse: Record<string, unknown>) {
  const res = await fetch(`https://developer.world.org/api/v4/verify/${env.worldRpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...idkitResponse, environment: env.worldEnv }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`world_verify_failed:${res.status}`);
  const data = (await res.json()) as { success?: boolean; nullifier?: string; action?: string; nullifier_hash?: string };
  if (!data.success) throw new Error("world_verify_failed");
  return { nullifier: String(data.nullifier ?? data.nullifier_hash), action: String(data.action) };
}
