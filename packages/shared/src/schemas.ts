import { z } from "zod";

export const hederaAccount = z.string().regex(/^0\.0\.\d+$/, "Format 0.0.12345");
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers, dashes").min(2).max(40);

export const createAgentSchema = z.object({
  name: z.string().min(2).max(40),
  // Omit it and the gateway creates a custodial testnet wallet for the agent.
  hederaAccountId: hederaAccount.optional(),
  perCallCap: z.number().int().positive(),
  dailyCap: z.number().int().positive(),
  approvalThreshold: z.number().int().nonnegative(),
  minScore: z.number().int().min(0).max(100).default(80),
}).refine((a) => a.dailyCap >= a.perCallCap, { message: "Daily cap must be at least the per-call cap", path: ["dailyCap"] })
  .refine((a) => a.approvalThreshold <= a.perCallCap, { message: "Approval threshold must be at most the per-call cap", path: ["approvalThreshold"] });

export const patchAgentSchema = z.object({
  name: z.string().min(2).max(40).optional(),
  perCallCap: z.number().int().positive().optional(),
  dailyCap: z.number().int().positive().optional(),
  approvalThreshold: z.number().int().nonnegative().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  allowlistOnly: z.boolean().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export const allowlistSchema = z.object({ merchantIds: z.array(z.string()) });

export const jsonSchemaObject = z.record(z.string(), z.unknown()).refine(
  (s) => s.type === "object" && Array.isArray(s.required) && s.required.length > 0,
  { message: 'Schema must have type "object" and a non-empty "required" list' },
);

/** A merchant describes what it sells; agents match requests against these words. */
export const category = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,23}$/, "Short lowercase word, e.g. food");
export const keywords = z.array(z.string().trim().toLowerCase().min(2).max(24)).max(24);

export const createMerchantSchema = z.object({
  name: z.string().min(2).max(60),
  slug,
  endpointUrl: z.string().url(),
  payoutAccountId: hederaAccount,
  price: z.number().int().positive(),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  responseSchema: jsonSchemaObject,
  category: category.default("other"),
  keywords: keywords.default([]),
  description: z.string().trim().max(160).optional(),
  samplePrompt: z.string().trim().max(120).optional(),
});

export const patchMerchantSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  endpointUrl: z.string().url().optional(),
  payoutAccountId: hederaAccount.optional(),
  price: z.number().int().positive().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  responseSchema: jsonSchemaObject.optional(),
  category: category.optional(),
  keywords: keywords.optional(),
  description: z.string().trim().max(160).optional(),
  samplePrompt: z.string().trim().max(120).optional(),
  status: z.enum(["paused", "live"]).optional(),
});

export const depositSchema = z.object({ txId: z.string().min(5) });
/** Micro-USDC (6 decimals), so 1 USDC = 1_000_000. */
export const withdrawSchema = z.object({ amount: z.number().int().positive() });

/** IDKit proof of human, submitted by a signed-in account that wants to become a merchant. */
export const worldVerifySchema = z.object({
  idkitResponse: z.record(z.string(), z.unknown()),
});

export const roleSchema = z.enum(["owner", "merchant"]);
export const enableRoleSchema = z.object({ role: roleSchema });
export const patchMeSchema = z.object({ displayName: z.string().trim().min(1).max(40) });
export const devLoginSchema = z.object({ name: z.string().trim().min(1).max(40).regex(/^[\w .-]+$/, "Letters, numbers, spaces, . _ -") });

export const demoRunSchema = z.object({ scenario: slug });

/** Console: the owner asks; the agent picks the merchant and pays. `slug` pins the merchant on a retry after approval. */
export const askSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  approvalId: z.string().optional(),
  slug: slug.optional(),
});

/** Scheduled top-ups: `times` transfers of `amount` micro-USDC, the first `everySec` from now, then every `everySec`. Max 62 days out (network limit). */
export const scheduleFundingSchema = z.object({
  amount: z.number().int().min(100_000).max(5_000_000),
  everySec: z.number().int().min(120).max(30 * 86_400),
  times: z.number().int().min(1).max(8),
}).refine((s) => s.everySec * s.times <= 62 * 86_400, { message: "Schedules may reach at most 62 days ahead", path: ["times"] });

/** Playground: the owner has a custodial agent pay a merchant for real. */
export const playSchema = z.object({
  slug,
  body: z.record(z.string(), z.unknown()).optional(),
  approvalId: z.string().optional(),
});
