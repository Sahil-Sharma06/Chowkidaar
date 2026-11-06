import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const now = () => Date.now();

/**
 * One row per human. The login identity is World ID Agent Pass (`iss|sub`, action "agent-pass-oidc");
 * "dev" accounts exist only when Agent Pass is not configured and DEMO_MODE is on.
 * Roles are capabilities on the same account: one person can run agents and sell a service.
 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  worldAction: text("world_action").notNull(),
  // Text, because a nullifier is too large for a SQLite integer.
  worldNullifier: text("world_nullifier").notNull(),
  displayName: text("display_name"),
  isOwner: integer("is_owner", { mode: "boolean" }).notNull().default(false),
  isMerchant: integer("is_merchant", { mode: "boolean" }).notNull().default(false),
  // IDKit Proof of Human nullifier for "merchant-register-v1": one human, one merchant, forever.
  merchantNullifier: text("merchant_nullifier").unique(),
  merchantVerifiedAt: integer("merchant_verified_at"),
  lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [uniqueIndex("uniq_nullifier").on(t.worldNullifier, t.worldAction)]);

/** Server-side sessions: the cookie holds a random token, the DB holds its hash, so logout really revokes. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // sha256(token)
  accountId: text("account_id").notNull().references(() => accounts.id),
  userAgent: text("user_agent"),
  // Agent Pass step-up: a fresh verification grants one sensitive action of this scope, briefly.
  stepUpScope: text("step_up_scope"),
  stepUpAt: integer("step_up_at"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  lastSeenAt: integer("last_seen_at").notNull().$defaultFn(now),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (t) => [index("idx_sessions_account").on(t.accountId)]);

/** In-flight Agent Pass (OIDC) requests: PKCE verifier + nonce, single use, short-lived. */
export const oidcStates = sqliteTable("oidc_states", {
  state: text("state").primaryKey(),
  verifier: text("verifier").notNull(),
  nonce: text("nonce").notNull(),
  purpose: text("purpose", { enum: ["login", "approval", "stepup"] }).notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, string>>().notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  hederaAccountId: text("hedera_account_id").notNull().unique(),
  apiKeyHash: text("api_key_hash").notNull(),
  // Custodial agents (playground): the gateway created the wallet and keeps its key + API key sealed here.
  custodialEnc: text("custodial_enc"),
  // HCS-14 Universal Agent ID (uaid:aid:...), registered on the HCS topic at creation; uaidSeq is that message.
  uaid: text("uaid"),
  uaidSeq: integer("uaid_seq"),
  perCallCap: integer("per_call_cap").notNull(),
  dailyCap: integer("daily_cap").notNull(),
  approvalThreshold: integer("approval_threshold").notNull(),
  minScore: integer("min_score").notNull().default(80),
  allowlistOnly: integer("allowlist_only", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  accountId: text("account_id").references(() => accounts.id), // Null only for seeded demo merchants
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  endpointUrl: text("endpoint_url").notNull(),
  payoutAccountId: text("payout_account_id").notNull(),
  price: integer("price").notNull(),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  responseSchema: text("response_schema", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  // What the merchant sells, in its own words. Agents route requests by matching these.
  category: text("category").notNull().default("other"),
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
  description: text("description"),
  samplePrompt: text("sample_prompt"),
  status: text("status", {
    enum: ["draft", "testing", "needs_bond", "live", "paused", "suspended"],
  }).notNull().default("draft"),
  bondBalance: integer("bond_balance").notNull().default(0),
  bondLocked: integer("bond_locked").notNull().default(0),
  totalCalls: integer("total_calls").notNull().default(0),
  failedCalls: integer("failed_calls").notNull().default(0),
  score: integer("score"), // Null until there are enough calls
  arkivEntityKey: text("arkiv_entity_key"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const allowedMerchants = sqliteTable("allowed_merchants", {
  agentId: text("agent_id").notNull().references(() => agents.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
}, (t) => [uniqueIndex("uniq_allow").on(t.agentId, t.merchantId)]);

export const bondLedger = sqliteTable("bond_ledger", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  type: text("type", { enum: ["deposit", "slash", "withdraw"] }).notNull(),
  amount: integer("amount").notNull(),
  // Unique, so one deposit transaction can never be credited twice.
  txId: text("tx_id").unique(),
  paymentId: text("payment_id"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  amount: integer("amount").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "used", "expired"] })
    .notNull().default("pending"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  merchantId: text("merchant_id").notNull().references(() => merchants.id),
  price: integer("price").notNull(),
  fee: integer("fee").notNull(),
  status: text("status", {
    enum: ["calling", "delivered", "refund_pending", "refunded", "refund_failed"],
  }).notNull(),
  failureReason: text("failure_reason"),
  failureDetail: text("failure_detail"),
  faultCase: text("fault_case", { enum: ["A", "B", "C"] }),
  agentTxId: text("agent_tx_id").notNull().unique(), // Blocks reuse of a settlement
  merchantTxId: text("merchant_tx_id"),
  merchantPaid: integer("merchant_paid", { mode: "boolean" }),
  refundTxId: text("refund_tx_id"),
  refundAmount: integer("refund_amount"),
  slashAmount: integer("slash_amount"),
  httpStatus: integer("http_status"),
  latencyMs: integer("latency_ms"),
  responseHash: text("response_hash"),
  hcsSequence: integer("hcs_sequence"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  finishedAt: integer("finished_at"),
}, (t) => [
  index("idx_payments_agent").on(t.agentId, t.createdAt),
  index("idx_payments_merchant").on(t.merchantId, t.createdAt),
]);

/** Scheduled Transactions (HIP-423) that top up a custodial agent from the gateway at a set time. */
export const fundingSchedules = sqliteTable("funding_schedules", {
  scheduleId: text("schedule_id").primaryKey(), // Hedera schedule entity 0.0.x
  agentId: text("agent_id").notNull().references(() => agents.id),
  amount: integer("amount").notNull(),
  executeAt: integer("execute_at").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
}, (t) => [index("idx_funding_agent").on(t.agentId)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["refund", "hcs", "arkiv"] }).notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextRunAt: integer("next_run_at").notNull(),
  doneAt: integer("done_at"),
  lastError: text("last_error"),
});

export type Agent = typeof agents.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
