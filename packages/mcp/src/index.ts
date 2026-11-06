#!/usr/bin/env node
/**
 * Chowkidaar MCP server: lets Claude, ChatGPT or any MCP host pay bonded merchants on Hedera
 * through one of your Chowkidaar agents, inside the owner's limits (per-call cap, daily cap,
 * allowlist, approval threshold). A failed service is refunded from the merchant's bond.
 *
 * Config (env): CHOWKIDAAR_URL (gateway, default http://localhost:4000),
 *               CHOWKIDAAR_AGENT_KEY (the agent's API key, apk_...),
 *               CHOWKIDAAR_MIRROR_URL (optional, default Hedera testnet mirror node).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GATEWAY = (process.env.CHOWKIDAAR_URL ?? "http://localhost:4000").replace(/\/$/, "");
const KEY = process.env.CHOWKIDAAR_AGENT_KEY ?? "";
const MIRROR = (process.env.CHOWKIDAAR_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com").replace(/\/$/, "");
if (!KEY) { console.error("CHOWKIDAAR_AGENT_KEY is not set. Create an agent in the Chowkidaar web app and copy its API key."); process.exit(1); }

const usd = (micro: string | number | null | undefined) => micro == null ? "—" : `${(Number(micro) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: { "content-type": "application/json", "x-agent-key": KEY, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let body: unknown; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${typeof body === "object" ? JSON.stringify(body) : String(body)}`);
  return body as T;
}
const text = (s: string, structured?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: s }], ...(structured ? { structuredContent: structured } : {}) });

type Merchant = { id: string; slug: string; name: string; category: string; price: string; score: number | null; totalCalls: number; covered: boolean; description: string | null; keywords: string[]; samplePrompt: string | null };
type Agent = { id: string; name: string; hederaAccountId: string; custodial: boolean; status: string; perCallCap: string; dailyCap: string; approvalThreshold: string; minScore: number; allowlistOnly: boolean; allowedMerchantIds: string[]; spentToday: string };
type Candidate = { slug: string; name: string; category: string; price: string; total: string; score: number | null; matched: string[]; eligible: boolean; why: string[] };
type Ask = { outcome: string; intent: { words: string[]; categories: string[] }; scoreSource: string; candidates: Candidate[]; merchant: Candidate | null; status: number | null; body: Record<string, unknown> | null; agentTx: string | null; error?: string; webOrigin: string };

const WHY: Record<string, string> = { no_match: "doesn't sell that", not_allowed: "not on the agent's allowlist", not_covered: "bond too low to cover a call", above_cap: "price above the per-call cap", merchant_cap: "today's limit for this merchant is used up", low_score: "score below the agent's minimum" };
const REASON: Record<string, string> = { http_error: "the service returned an error", timeout: "the service took too long", empty_body: "the service returned nothing", bad_format: "the response was not in the agreed format", price_mismatch: "the merchant asked a different price", network_error: "the service could not be reached", gateway_error: "a gateway error (our fault, full refund)" };
const POLICY: Record<string, string> = { per_call_cap_exceeded: "above the agent's per-call cap", daily_cap_exceeded: "the agent's daily cap is reached", merchant_daily_cap_exceeded: "today's limit for this merchant is reached", merchant_not_allowed: "the merchant is not on the allowlist", merchant_low_reputation: "the merchant's score is below the agent's minimum", merchant_not_covered: "the merchant's bond cannot cover this call", agent_paused: "the agent is paused" };

const server = new McpServer({ name: "chowkidaar", version: "0.1.0" });

server.registerTool("wallet", {
  title: "Agent wallet and limits",
  description: "Shows the Chowkidaar agent behind this key: its Hedera account, USDC balance, spending limits and how much it spent today. Call this before paying if you are unsure the agent can afford something.",
  inputSchema: {},
}, async () => {
  const a = await api<Agent>("/v1/agent");
  const t = await fetch(`${MIRROR}/api/v1/accounts/${a.hederaAccountId}/tokens?token.id=0.0.429274`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { tokens: { balance: number }[] } | null;
  const balance = t?.tokens?.[0]?.balance ?? null;
  return text([
    `Agent "${a.name}" (${a.status}), Hedera account ${a.hederaAccountId}${a.custodial ? " (wallet held by the gateway)" : ""}.`,
    `USDC balance: ${usd(balance)}.`,
    `Limits: up to ${usd(a.perCallCap)} per call, ${usd(a.dailyCap)} per day (spent today ${usd(a.spentToday)}), owner approval needed above ${usd(a.approvalThreshold)}, minimum merchant score ${a.minScore}, ${a.allowlistOnly ? `${a.allowedMerchantIds.length} allowed merchants` : "any live merchant"}.`,
  ].join("\n"), { ...a, usdcMicro: balance });
});

server.registerTool("list_merchants", {
  title: "List bonded merchants",
  description: "Lists the services this agent could pay for: name, category, price, Arkiv reputation score, whether the merchant's bond covers a refund, and what to ask for. Use it to see what is on offer before calling ask.",
  inputSchema: { category: z.string().optional().describe("Only this category, e.g. food") },
}, async ({ category }) => {
  const [list, a] = await Promise.all([api<Merchant[]>("/api/public/merchants"), api<Agent>("/v1/agent")]);
  const rows = list.filter((m) => !category || m.category === category.toLowerCase());
  const lines = rows.map((m) => {
    const allowed = !a.allowlistOnly || a.allowedMerchantIds.includes(m.id);
    return `- ${m.name} [${m.category}] ${usd(m.price)} · score ${m.score ?? `new (${m.totalCalls} calls)`} · ${m.covered ? "bond covers refunds" : "NOT covered"}${allowed ? "" : " · not on your allowlist"}${m.description ? ` — ${m.description}` : ""}${m.samplePrompt ? ` (try: "${m.samplePrompt}")` : ""}`;
  });
  return text(rows.length ? lines.join("\n") : "No merchants in that category.", { merchants: rows });
});

server.registerTool("ask", {
  title: "Pay a merchant for something",
  description: [
    "Ask Chowkidaar for a service in plain words (\"get me a burger\", \"what's the HBAR price\"). The agent picks the best-rated bonded merchant that sells it, PAYS IT WITH REAL USDC on Hedera over x402, and returns the merchant's answer.",
    "If the service fails any objective check, the agent is refunded automatically from the merchant's bond. If the price is above the owner's approval threshold the call is held; the owner approves it in the Chowkidaar web app, then call ask again with the approvalId.",
    "This spends money: only call it when the user actually wants the thing.",
  ].join(" "),
  inputSchema: {
    query: z.string().min(1).max(2000).describe("What the user wants, in their words"),
    approvalId: z.string().optional().describe("Approval id from a previous held call, after the owner approved it"),
    slug: z.string().optional().describe("Pin a specific merchant slug (normally omit; the agent chooses)"),
  },
}, async ({ query, approvalId, slug }) => {
  const r = await api<Ask>("/v1/ask", { method: "POST", body: JSON.stringify({ query, approvalId, slug }) });
  const m = r.merchant;
  const b = r.body ?? {};
  const understood = r.intent.words.length ? `Understood as ${r.intent.categories.join("/")} (matched: ${r.intent.words.join(", ")}).` : "";
  const picked = m ? `Chose ${m.name} (${m.category}, ${usd(m.price)}, score ${m.score ?? "new"})${r.candidates.filter((c) => c.eligible && c.slug !== m.slug).length ? ` over ${r.candidates.filter((c) => c.eligible && c.slug !== m.slug).map((c) => `${c.name} (${c.score ?? "new"})`).join(", ")}` : ""}; scores from ${r.scoreSource === "arkiv" ? "Arkiv" : "the gateway"}.` : "";
  const receipt = typeof b.receiptUrl === "string" ? `Receipt: ${b.receiptUrl}` : typeof b.paymentId === "string" ? `Receipt: ${r.webOrigin}/receipts/${b.paymentId}` : "";
  const paid = m ? `Paid ${usd(m.total)} (price + 2% protection fee)${r.agentTx ? `, Hedera tx ${r.agentTx}` : ""}.` : "";
  let out: string;
  switch (r.outcome) {
    case "delivered":
      out = `${m?.name} delivered:\n${JSON.stringify(b.data, null, 2)}\n\n${picked}\n${paid} ${receipt}`; break;
    case "refund_pending":
      out = `${m?.name} failed: ${REASON[String(b.reason)] ?? String(b.reason)}${b.detail ? ` (${String(b.detail)})` : ""}.\nA refund of ${usd(String(b.refundAmount))} is already on its way ${b.faultCase === "A" ? "from the merchant's bond (the merchant is also slashed)" : b.faultCase === "B" ? "from the gateway (the merchant was never paid)" : "in full (this one was the gateway's fault)"}; the user only loses the protection fee.\n${picked}\n${paid} ${receipt} (poll it with get_receipt until status is "refunded")`; break;
    case "held":
      out = `This costs ${usd(m?.total)}, above the owner's approval threshold, so nothing was paid. Ask the owner to approve it at ${r.webOrigin}/owner/approvals (approval id ${String(b.approvalId)}, valid 15 minutes), then call ask again with approvalId="${String(b.approvalId)}" and slug="${m?.slug}".`; break;
    case "blocked":
      out = `Blocked before any payment: ${POLICY[String(b.error)] ?? String(b.error)}. No money moved. ${picked}`; break;
    case "no_merchant":
      out = `${understood || "No merchant sells that, as far as they have told us."} Nothing was paid.\n` + r.candidates.map((c) => `- ${c.name} [${c.category}] ${usd(c.price)}: ${c.why.map((w) => WHY[w] ?? w).join(", ")}`).join("\n"); break;
    default:
      out = `Something went wrong before the call completed: ${r.error ?? JSON.stringify(b)}`;
  }
  return text(`${understood}\n${out}`.trim(), { outcome: r.outcome, merchant: m, intent: r.intent, status: r.status, agentTx: r.agentTx, body: r.body, error: r.error ?? null });
});

server.registerTool("get_receipt", {
  title: "Get a payment receipt",
  description: "Full receipt of one Chowkidaar payment: status (delivered / refund_pending / refunded), money breakdown, Hedera transaction ids, HCS sequence and Arkiv entity. Use it to confirm a refund landed.",
  inputSchema: { paymentId: z.string().describe("pay_... id from an ask result or receipt URL") },
}, async ({ paymentId }) => {
  const r = await api<Record<string, unknown>>(`/api/public/receipts/${encodeURIComponent(paymentId)}`);
  const money = r.money as Record<string, string>; const links = r.links as Record<string, string | null>; const hcs = r.hcs as { sequence: number | null };
  return text([
    `Payment ${paymentId}: ${String(r.status)}${r.reason ? ` (${String(r.reason)})` : ""}.`,
    `Agent paid ${usd(money.agentPaid)}, merchant received ${usd(money.merchantReceived)}, refunded ${usd(money.refunded)}, bond slashed ${usd(money.bondSlashed)}.`,
    `Agent tx: ${links.agent ?? "—"}\nMerchant tx: ${links.merchant ?? "—"}\nRefund tx: ${links.refund ?? "—"}\nHCS: ${hcs.sequence ? `#${hcs.sequence} ${links.hcs}` : "pending"}${links.arkiv ? `\nArkiv: ${links.arkiv}` : ""}`,
  ].join("\n"), r);
});

await server.connect(new StdioServerTransport());
