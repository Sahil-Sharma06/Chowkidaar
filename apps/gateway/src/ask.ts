/**
 * "Ask": the agent chooses a merchant and pays. Shared by the web console (session) and the
 * agent API / MCP server (agent key). Merchants are judged only on what they declared about
 * themselves (category, keywords) and on the owner's policy; reputation comes from Arkiv.
 */
import { eq } from "drizzle-orm";
import { matchWords } from "@app/shared";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import type { Agent } from "./db/schema.ts";
import { env } from "./env.ts";
import { lockFor, rankFor, scoreFor, totalFor } from "./money.ts";

const { allowedMerchants, merchants } = schema;

export type AskInput = { query: string; approvalId?: string; slug?: string };
export type Candidate = {
  id: string; slug: string; name: string; category: string; price: string; total: string;
  score: number | null; rank: number; calls: number; matched: string[]; eligible: boolean; why: string[];
};
export type AskResult = {
  outcome: "delivered" | "refund_pending" | "held" | "blocked" | "error" | "no_merchant";
  intent: { words: string[]; categories: string[] };
  scoreSource: "arkiv" | "gateway";
  candidates: Candidate[];
  merchant: Candidate | null;
  status: number | null;
  body: Record<string, unknown> | null;
  agentTx: string | null;
  error?: string;
  webOrigin: string;
};

/** Share of requests that try a new merchant (under 5 calls) instead of the best-ranked one. */
export const EXPLORE_RATE = Number(process.env.EXPLORE_RATE ?? 0.15);

/**
 * Usually the best-ranked eligible merchant. Sometimes, a new eligible merchant that matched just
 * as well, so newcomers can earn a track record. That is safe to do only because the newcomer's
 * bond already covers a refund: the agent risks nothing by trying it.
 */
export function pick(candidates: Candidate[], random: () => number = Math.random): Candidate | undefined {
  const best = candidates.find((m) => m.eligible);
  if (!best) return undefined;
  const newcomers = candidates.filter((m) => m.eligible && m.calls < 5 && m.matched.length === best.matched.length && m !== best);
  if (newcomers.length && best.calls >= 5 && random() < EXPLORE_RATE) return newcomers[Math.floor(random() * newcomers.length)];
  return best;
}

export async function askAsAgent(db: Db, a: Agent, { query, approvalId, slug: pinned }: AskInput, random: () => number = Math.random): Promise<AskResult> {
  // Reputation as the public record on Arkiv says it; the gateway's own numbers only if Arkiv is down.
  const counts = new Map<string, { total: number; failed: number }>();
  let scoreSource: "arkiv" | "gateway" = "gateway";
  try {
    const { cachedReputations } = await import("./chain/arkiv.ts");
    for (const r of await cachedReputations(10_000)) counts.set(r.merchantId, { total: r.totalCalls, failed: r.failedCalls });
    scoreSource = "arkiv";
  } catch { /* fall back to local counters */ }

  const allowedIds = new Set(db.select({ id: allowedMerchants.merchantId }).from(allowedMerchants).where(eq(allowedMerchants.agentId, a.id)).all().map((x) => x.id));
  // Only merchants whose own words match the request are considered: the agent never pays
  // someone for something they do not sell.
  const candidates: Candidate[] = db.select().from(merchants).where(eq(merchants.status, "live")).all().map((m) => {
    const c = scoreSource === "arkiv" ? counts.get(m.id) ?? { total: 0, failed: 0 } : { total: m.totalCalls, failed: m.failedCalls };
    // Same rule as the policy check: under 5 calls a merchant is "new" and has no public score.
    const score = scoreFor(c.total, c.failed);
    const matched = matchWords(query, m);
    const why: string[] = [];
    if (matched.length === 0) why.push("no_match");
    if (a.allowlistOnly && !allowedIds.has(m.id)) why.push("not_allowed");
    if (m.bondBalance - m.bondLocked < lockFor(m.price)) why.push("not_covered");
    if (m.price > a.perCallCap) why.push("above_cap");
    if (score !== null && score < a.minScore) why.push("low_score");
    const rank = rankFor(c.total, c.failed);
    return { id: m.id, slug: m.slug, name: m.name, category: m.category, price: String(m.price), total: String(totalFor(m.price)), score, rank, calls: c.total, matched, eligible: why.length === 0, why };
  }).sort((x, y) => y.matched.length - x.matched.length || y.rank - x.rank || Number(x.price) - Number(y.price));
  const intent = { words: [...new Set(candidates.flatMap((m) => m.matched))], categories: [...new Set(candidates.filter((m) => m.matched.length).map((m) => m.category))] };
  const base = { intent, scoreSource, candidates, webOrigin: env.webOrigin };

  const chosen = pinned ? candidates.find((m) => m.slug === pinned) : pick(candidates, random);
  if (!chosen) return { outcome: "no_merchant", ...base, merchant: null, status: null, body: null, agentTx: null };
  if (!a.custodialEnc) return { outcome: "error", ...base, merchant: chosen, status: null, body: null, agentTx: null, error: "This agent pays with its own key; ask is only for gateway-held wallets." };

  try {
    const { payAsAgent, unseal } = await import("./custody.ts");
    const { walletKey, apiKey } = unseal(a.custodialEnc);
    const r = await payAsAgent({ accountId: a.hederaAccountId, walletKey, apiKey, slug: chosen.slug, body: { query }, approvalId });
    const outcome = r.status === 200 ? "delivered" : r.status === 502 ? "refund_pending" : r.status === 202 ? "held" : r.status === 401 || r.status === 403 ? "blocked" : "error";
    const error = r.status === 402 ? `The gateway did not accept the payment: ${r.paymentError}. Nothing was charged.` : outcome === "error" ? `Gateway answered ${r.status}` : undefined;
    return { outcome, ...base, merchant: chosen, status: r.status, body: r.body, agentTx: r.agentTx, error };
  } catch (err) {
    return { outcome: "error", ...base, merchant: chosen, status: null, body: null, agentTx: null, error: String((err as Error).message ?? err).slice(0, 300) };
  }
}
