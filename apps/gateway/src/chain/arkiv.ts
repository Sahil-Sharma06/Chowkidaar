import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { defineSchema, dec, str, u64 } from "@arkiv-network/sdk/schema";
import { eq } from "@arkiv-network/sdk/query";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, hasArkiv } from "../env.ts";

export const SCHEMA_NAME = "agent-payment-protection.merchant-reputation.v1";

export const MerchantReputation = defineSchema(SCHEMA_NAME, {
  merchantId: str().indexed(),
  slug: str().indexed(),
  score: dec().indexed(),
  totalCalls: u64(),
  failedCalls: u64(),
  updatedAt: u64(),
});

export type Stats = { merchantId: string; slug: string; score: number; totalCalls: number; failedCalls: number };

const chain = rabdi({ accessKey: env.arkivAccessKey });
const account = hasArkiv() ? privateKeyToAccount(env.arkivPrivateKey as Hex) : null;

export const arkivWriterAddress = account?.address ?? null;
export const arkivRead = createPublicClient({ chain, transport: http() });
const arkivWrite = account ? createWalletClient({ chain, transport: http(), account }) : null;

const toValues = (s: Stats) => ({
  merchantId: s.merchantId,
  slug: s.slug,
  score: dec(s.score.toFixed(2)),
  totalCalls: u64(BigInt(s.totalCalls)),
  failedCalls: u64(BigInt(s.failedCalls)),
  updatedAt: u64(BigInt(Math.floor(Date.now() / 1000))),
});

export async function createReputation(s: Stats): Promise<string> {
  if (!arkivWrite) throw new Error("arkiv_disabled");
  const { entityKey } = await arkivWrite.createEntity(MerchantReputation, toValues(s), {
    expiration: ExpirationTime.fromDays(180),
  });
  return entityKey;
}

export async function updateReputation(entityKey: string, s: Stats) {
  if (!arkivWrite) throw new Error("arkiv_disabled");
  await arkivWrite.patchEntity(MerchantReputation, entityKey as Hex, { set: toValues(s) });
}

export type ArkivReputation = { key: string; merchantId: string; slug: string; score: number; totalCalls: number; failedCalls: number; updatedAt: number };

/** Every reputation entity our writer published, in one query (what the public merchants page shows). */
export async function listReputations(owner: Hex): Promise<ArkivReputation[]> {
  const { entities } = await arkivRead
    .select({ $key: true, merchantId: true, slug: true, score: true, totalCalls: true, failedCalls: true, updatedAt: true })
    .from(MerchantReputation)
    .ownedBy(owner) // Only our gateway's records count; anyone else can write look-alike entities
    .fetch();
  // Keep the newest record per merchant: an older entity can outlive a reset of our database.
  const latest = new Map<string, ArkivReputation>();
  for (const e of entities) {
    const r: ArkivReputation = {
      key: e.$key as string, merchantId: String(plain(e.merchantId)), slug: String(plain(e.slug)),
      score: Number(plain(e.score)), totalCalls: Number(plain(e.totalCalls)), failedCalls: Number(plain(e.failedCalls)),
      updatedAt: Number(plain(e.updatedAt)),
    };
    const prev = latest.get(r.merchantId);
    if (!prev || r.updatedAt > prev.updatedAt) latest.set(r.merchantId, r);
  }
  return [...latest.values()];
}

// ponytail: one in-process cache; fine for a single gateway.
let repCache: { at: number; list: ArkivReputation[] } | null = null;
/** Our writer's reputation entities, re-read from Arkiv at most every `ttlMs`. */
export async function cachedReputations(ttlMs = 30_000): Promise<ArkivReputation[]> {
  if (!env.arkivWriterAddress) return [];
  if (repCache && Date.now() - repCache.at < ttlMs) return repCache.list;
  const list = await listReputations(env.arkivWriterAddress as Hex);
  repCache = { at: Date.now(), list };
  return list;
}

/** Arkiv returns typed attributes as `{ type, value }`; this turns one into a plain number or string. */
export const plain = (v: unknown): string | number => {
  const x = v && typeof v === "object" && "value" in v ? (v as { value: unknown }).value : v;
  return typeof x === "bigint" ? Number(x) : typeof x === "number" ? x : String(x ?? "");
};

export async function readReputation(merchantId: string, owner: Hex) {
  const { entities } = await arkivRead
    .select({ $key: true, score: true, totalCalls: true, failedCalls: true, slug: true })
    .from(MerchantReputation)
    .where(eq("merchantId", merchantId))
    .ownedBy(owner) // Ignore entities written by anyone else
    .fetch();
  const e = entities[0];
  if (!e) return null;
  return {
    key: e.$key as string, slug: String(plain(e.slug)),
    score: Number(plain(e.score)), totalCalls: Number(plain(e.totalCalls)), failedCalls: Number(plain(e.failedCalls)),
  };
}
