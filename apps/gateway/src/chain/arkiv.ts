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

export async function readReputation(merchantId: string, owner: Hex) {
  const { entities } = await arkivRead
    .select({ $key: true, score: true, totalCalls: true, failedCalls: true, slug: true })
    .from(MerchantReputation)
    .where(eq("merchantId", merchantId))
    .ownedBy(owner) // Ignore entities written by anyone else
    .fetch();
  return entities[0] ?? null;
}
