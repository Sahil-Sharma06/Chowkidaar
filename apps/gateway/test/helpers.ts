import { eq } from "drizzle-orm";
import { openDb, schema, type Db } from "../src/db/index.ts";
import { sha256 } from "../src/ids.ts";

export const API_KEY = "apk_test_key";
export const AGENT_ACCOUNT = "0.0.7777777";
export const MERCHANT_PAYOUT = "0.0.8888888";

export function freshDb(): Db {
  const { db } = openDb(":memory:");
  db.insert(schema.accounts).values({ id: "acct_owner", role: "owner", worldAction: "t", worldNullifier: "owner" }).run();
  db.insert(schema.agents).values({
    id: "agt_1", ownerId: "acct_owner", name: "Test agent", hederaAccountId: AGENT_ACCOUNT, apiKeyHash: sha256(API_KEY),
    perCallCap: 500_000, dailyCap: 5_000_000, approvalThreshold: 250_000, minScore: 80, allowlistOnly: true, status: "active",
  }).run();
  return db;
}

export function addMerchant(db: Db, over: Partial<typeof schema.merchants.$inferInsert> = {}) {
  const row: typeof schema.merchants.$inferInsert = {
    id: over.id ?? `mer_${over.slug ?? "good-data"}`,
    slug: over.slug ?? "good-data",
    name: over.name ?? "Good data",
    endpointUrl: over.endpointUrl ?? "http://127.0.0.1:1/m/good-data",
    payoutAccountId: MERCHANT_PAYOUT,
    price: over.price ?? 100_000,
    timeoutMs: over.timeoutMs ?? 5000,
    responseSchema: over.responseSchema ?? { type: "object", required: ["symbol", "price"], properties: { price: { type: "number" } } },
    status: over.status ?? "live",
    bondBalance: over.bondBalance ?? 2_000_000,
    bondLocked: over.bondLocked ?? 0,
    totalCalls: over.totalCalls ?? 0,
    failedCalls: over.failedCalls ?? 0,
    score: over.score ?? null,
  };
  db.insert(schema.merchants).values(row).run();
  db.insert(schema.allowedMerchants).values({ agentId: "agt_1", merchantId: row.id }).run();
  return db.select().from(schema.merchants).where(eq(schema.merchants.id, row.id)).get()!;
}
