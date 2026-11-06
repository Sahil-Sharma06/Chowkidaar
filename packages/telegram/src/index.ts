/**
 * Chowkidaar Telegram bot. Each Telegram user links one Chowkidaar agent (/link apk_...),
 * then asks in plain words ("get me a burger"); the bot calls the gateway, which pays the
 * best bonded merchant over x402 on Hedera and refunds from the bond when the service fails.
 *
 * The bot is a thin client like the MCP server: no keys, no chain code, nothing but gateway calls.
 * Long polling (getUpdates), so it runs anywhere without a public URL.
 *
 * Env: TELEGRAM_BOT_TOKEN (from @BotFather), CHOWKIDAAR_URL (default GATEWAY_URL or http://localhost:4000),
 *      TELEGRAM_LINKS_FILE (default packages/telegram/data/links.json), MIRROR_URL.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN is not set (create a bot with @BotFather)."); process.exit(1); }
const GATEWAY = (process.env.CHOWKIDAAR_URL ?? process.env.GATEWAY_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MIRROR = (process.env.MIRROR_URL ?? "https://testnet.mirrornode.hedera.com").replace(/\/$/, "");
const USDC = process.env.USDC_TOKEN_ID ?? "0.0.429274";
const TG = `https://api.telegram.org/bot${TOKEN}`;
const here = dirname(fileURLToPath(import.meta.url));
const LINKS = process.env.TELEGRAM_LINKS_FILE ?? resolve(here, "../data/links.json");

// chat id -> agent key. ponytail: a JSON file; move to an agents column when it must show in the owner UI.
let links: Record<string, string> = {};
try { links = JSON.parse(readFileSync(LINKS, "utf8")); } catch { /* first run */ }
const saveLinks = () => { mkdirSync(dirname(LINKS), { recursive: true }); writeFileSync(LINKS, JSON.stringify(links, null, 2)); };

const usd = (micro: string | number | null | undefined) => micro == null ? "—" : `${(Number(micro) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`;

type Merchant = { id: string; slug: string; name: string; category: string; price: string; score: number | null; totalCalls: number; covered: boolean; description: string | null; samplePrompt: string | null };
type Agent = { id: string; name: string; hederaAccountId: string; custodial: boolean; status: string; perCallCap: string; dailyCap: string; approvalThreshold: string; minScore: number; allowlistOnly: boolean; allowedMerchantIds: string[]; spentToday: string };
type Candidate = { slug: string; name: string; category: string; price: string; total: string; score: number | null; matched: string[]; eligible: boolean; why: string[] };
type Ask = { outcome: string; intent: { words: string[]; categories: string[] }; candidates: Candidate[]; merchant: Candidate | null; body: Record<string, unknown> | null; agentTx: string | null; error?: string; webOrigin: string };

const WHY: Record<string, string> = { no_match: "doesn't sell that", not_allowed: "not on your allowlist", not_covered: "bond too low to cover a call", above_cap: "price above your per-call cap", low_score: "score below your minimum" };
const REASON: Record<string, string> = { http_error: "returned an error", timeout: "took too long", empty_body: "returned nothing", bad_format: "replied in the wrong format", price_mismatch: "asked a different price", network_error: "could not be reached", gateway_error: "hit a gateway error (our fault, full refund)" };
const POLICY: Record<string, string> = { per_call_cap_exceeded: "above your per-call cap", daily_cap_exceeded: "your daily cap is reached", merchant_not_allowed: "the merchant is not on your allowlist", merchant_low_reputation: "the merchant's score is below your minimum", merchant_not_covered: "the merchant's bond cannot cover this call", agent_paused: "your agent is paused" };

class ApiError extends Error { constructor(public status: number, public body: unknown) { super(`http_${status}`); } }
async function api<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: { "content-type": "application/json", "x-agent-key": key }, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let body: unknown; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

async function tg(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${TG}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) });
  const j = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
const send = (chat: number, text: string) => tg("sendMessage", { chat_id: chat, text, disable_web_page_preview: true }).catch((e) => console.error("send failed", e));

const hashscan = (tx: string | null) => tx ? `https://hashscan.io/testnet/transaction/${tx}` : null;
const link = (chat: number) => links[String(chat)];

async function wallet(key: string) {
  const a = await api<Agent>(key, "/v1/agent");
  const t = await fetch(`${MIRROR}/api/v1/accounts/${a.hederaAccountId}/tokens?token.id=${USDC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { tokens: { balance: number }[] } | null;
  const balance = t?.tokens?.[0]?.balance ?? null;
  return [
    `Agent "${a.name}" (${a.status}) · Hedera ${a.hederaAccountId}${a.custodial ? "" : " (external wallet, cannot pay from chat)"}`,
    `Balance: ${usd(balance)}`,
    `Limits: ${usd(a.perCallCap)} per call · ${usd(a.dailyCap)} per day (spent today ${usd(a.spentToday)}) · owner approval above ${usd(a.approvalThreshold)} · min score ${a.minScore} · ${a.allowlistOnly ? `${a.allowedMerchantIds.length} allowed merchants` : "any live merchant"}`,
  ].join("\n");
}

async function merchants(key: string, category?: string) {
  const [list, a] = await Promise.all([api<Merchant[]>(key, "/api/public/merchants"), api<Agent>(key, "/v1/agent")]);
  const rows = list.filter((m) => !category || m.category === category.toLowerCase());
  if (!rows.length) return "No merchants in that category.";
  return rows.map((m) => {
    const allowed = !a.allowlistOnly || a.allowedMerchantIds.includes(m.id);
    return `• ${m.name} [${m.category}] ${usd(m.price)} · score ${m.score ?? `new (${m.totalCalls} calls)`} · ${m.covered ? "covered" : "NOT covered"}${allowed ? "" : " · not allowed"}${m.samplePrompt ? `\n   try: "${m.samplePrompt}"` : ""}`;
  }).join("\n");
}

async function ask(key: string, query: string, approvalId?: string, slug?: string) {
  const r = await api<Ask>(key, "/v1/ask", { method: "POST", body: JSON.stringify({ query, approvalId, slug }) });
  const m = r.merchant; const b = r.body ?? {};
  const receipt = typeof b.receiptUrl === "string" ? b.receiptUrl : typeof b.paymentId === "string" ? `${r.webOrigin}/receipts/${b.paymentId}` : null;
  const paid = m ? `Paid ${usd(m.total)} (price + 2% fee)${r.agentTx ? `\nHedera tx: ${hashscan(r.agentTx)}` : ""}` : "";
  const others = r.candidates.filter((c) => c.eligible && m && c.slug !== m.slug).map((c) => `${c.name} (${c.score ?? "new"})`);
  const picked = m ? `Chose ${m.name} (${m.category}, score ${m.score ?? "new"})${others.length ? ` over ${others.join(", ")}` : ""}.` : "";
  switch (r.outcome) {
    case "delivered":
      return `✅ ${m?.name} delivered:\n${JSON.stringify(b.data, null, 2)}\n\n${picked}\n${paid}${receipt ? `\nReceipt: ${receipt}` : ""}`;
    case "refund_pending":
      return `⚠️ ${m?.name} ${REASON[String(b.reason)] ?? String(b.reason)}${b.detail ? ` (${String(b.detail)})` : ""}.\n` +
        `Refund of ${usd(String(b.refundAmount))} is on its way ${b.faultCase === "A" ? "from the merchant's bond (merchant slashed 20% on top)" : b.faultCase === "B" ? "from the gateway (merchant was never paid)" : "in full (gateway's fault)"}. You only lose the protection fee.\n` +
        `${picked}\n${paid}${receipt ? `\nReceipt: ${receipt}` : ""}\nSend /receipt ${String(b.paymentId ?? "")} to see it land.`;
    case "held":
      return `⏸ ${m?.name} costs ${usd(m?.total)}, above your approval threshold, so nothing was paid.\nApprove it at ${r.webOrigin}/owner/approvals (15 minutes), then send:\n/retry ${String(b.approvalId)} ${m?.slug}`;
    case "blocked":
      return `⛔ Blocked before any payment: ${POLICY[String(b.error)] ?? String(b.error)}. No money moved.`;
    case "no_merchant":
      return `🤷 ${r.intent.words.length ? `Understood as ${r.intent.categories.join("/")} but ` : ""}no merchant can take that. Nothing was paid.\n` +
        r.candidates.slice(0, 8).map((c) => `• ${c.name} [${c.category}] ${usd(c.price)}: ${c.why.map((w) => WHY[w] ?? w).join(", ")}`).join("\n");
    default:
      return `❌ Something went wrong before the call completed: ${r.error ?? JSON.stringify(b)}`;
  }
}

async function receipt(key: string, id: string) {
  const r = await api<Record<string, unknown>>(key, `/api/public/receipts/${encodeURIComponent(id)}`);
  const money = r.money as Record<string, string>; const l = r.links as Record<string, string | null>; const hcs = r.hcs as { sequence: number | null };
  return [
    `Payment ${id}: ${String(r.status)}${r.reason ? ` (${String(r.reason)})` : ""}`,
    `Agent paid ${usd(money.agentPaid)} · merchant got ${usd(money.merchantReceived)} · refunded ${usd(money.refunded)} · bond slashed ${usd(money.bondSlashed)}`,
    l.agent ? `Agent tx: ${l.agent}` : "", l.merchant ? `Merchant tx: ${l.merchant}` : "", l.refund ? `Refund tx: ${l.refund}` : "",
    `HCS: ${hcs.sequence ? `#${hcs.sequence} ${l.hcs}` : "pending"}`, l.arkiv ? `Arkiv: ${l.arkiv}` : "",
  ].filter(Boolean).join("\n");
}

const HELP = [
  "Chowkidaar pays bonded merchants on Hedera for you and refunds you from their bond when they fail.",
  "",
  "/link apk_...   link your agent (create one in the web app → Owner → Agents)",
  "/wallet         balance, limits, spent today",
  "/merchants [food|music|rides|data]",
  "/receipt pay_...",
  "/retry <approvalId> <slug>   after the owner approved a held payment",
  "/unlink",
  "",
  "Anything else is a request: \"get me a burger\", \"play some music\", \"book me a cab\".",
].join("\n");

async function handle(chat: number, msgId: number, textIn: string) {
  const [cmd, ...rest] = textIn.trim().split(/\s+/);
  const arg = rest.join(" ");
  const c = (cmd ?? "").replace(/@\w+$/, "").toLowerCase();
  if (c === "/start" || c === "/help") return send(chat, HELP);
  if (c === "/link") {
    if (!/^apk_/.test(arg)) return send(chat, "Usage: /link apk_... (the key shown once when you create or rotate an agent)");
    try {
      const a = await api<Agent>(arg, "/v1/agent");
      links[String(chat)] = arg; saveLinks();
      await tg("deleteMessage", { chat_id: chat, message_id: msgId }).catch(() => {}); // don't leave the key in the chat
      return send(chat, `Linked to agent "${a.name}" (${a.hederaAccountId}).${a.custodial ? "" : "\nNote: this agent has an external wallet; only custodial agents can pay from chat."}\n\n${await wallet(arg)}`);
    } catch (e) { return send(chat, e instanceof ApiError && e.status === 401 ? "That key was not accepted." : `Could not reach the gateway: ${String(e)}`); }
  }
  const key = link(chat);
  if (!key) return send(chat, "No agent linked yet. Send /link apk_... first.\n\n" + HELP);
  if (c === "/unlink") { delete links[String(chat)]; saveLinks(); return send(chat, "Unlinked."); }
  try {
    if (c === "/wallet") return send(chat, await wallet(key));
    if (c === "/merchants") return send(chat, await merchants(key, rest[0]));
    if (c === "/receipt") return send(chat, rest[0] ? await receipt(key, rest[0]) : "Usage: /receipt pay_...");
    if (c === "/retry") return rest.length >= 2 ? send(chat, await ask(key, "retry", rest[0], rest[1])) : send(chat, "Usage: /retry <approvalId> <slug>");
    if (c.startsWith("/")) return send(chat, "Unknown command.\n\n" + HELP);
    await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
    return send(chat, await ask(key, textIn));
  } catch (e) {
    if (e instanceof ApiError) {
      const b = e.body as { error?: string; detail?: string } | null;
      if (e.status === 401) { delete links[String(chat)]; saveLinks(); return send(chat, "Your agent key no longer works (rotated or deleted). Send /link again."); }
      return send(chat, `Gateway said ${e.status}: ${POLICY[String(b?.error)] ?? b?.error ?? "error"}${b?.detail ? ` — ${b.detail}` : ""}`);
    }
    return send(chat, `Error: ${String(e)}`);
  }
}

// Long-poll loop. One update at a time per chat is fine at hackathon scale.
type Update = { update_id: number; message?: { message_id: number; chat: { id: number; type: string }; text?: string } };
let offset = 0;
await tg("setMyCommands", { commands: [
  { command: "wallet", description: "Balance and limits" }, { command: "merchants", description: "What your agent can buy" },
  { command: "link", description: "Link your agent key" }, { command: "receipt", description: "Show a payment receipt" }, { command: "help", description: "How this works" },
] }).catch(() => {});
const me = (await tg("getMe", {})) as { username: string };
console.log(`telegram bot @${me.username} polling, gateway ${GATEWAY}, links ${LINKS} (${Object.keys(links).length} linked)`);
for (;;) {
  try {
    const updates = (await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] })) as Update[];
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m?.text || m.chat.type !== "private") continue;
      void handle(m.chat.id, m.message_id, m.text).catch((e) => console.error("handle failed", e));
    }
  } catch (e) { console.error("poll failed", e); await new Promise((r) => setTimeout(r, 3000)); }
}
