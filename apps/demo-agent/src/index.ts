/**
 * Scripted paying agent. Holds the AGENT key (the gateway never sees it), checks the
 * merchant's reputation on Arkiv, then pays the gateway over x402 and reports each step.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { DEMO_SCENARIOS, formatUsdc, hashscanTx, type DemoRunResult, type DemoStep } from "@app/shared";

const env = {
  network: (process.env.HEDERA_NETWORK || "hedera:testnet") as "hedera:testnet" | "hedera:mainnet",
  mirror: process.env.MIRROR_URL || "https://testnet.mirrornode.hedera.com",
  usdc: process.env.USDC_TOKEN_ID || "0.0.429274",
  agentId: process.env.AGENT_ACCOUNT_ID || "",
  agentKey: process.env.AGENT_PRIVATE_KEY || "",
  apiKey: process.env.DEMO_AGENT_KEY || "",
  gatewayUrl: process.env.GATEWAY_URL || "http://localhost:4000",
  port: Number(process.env.AGENT_PORT || 4200),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000",
  hashscan: process.env.NEXT_PUBLIC_HASHSCAN_URL || "https://hashscan.io/testnet",
  arkivAccessKey: process.env.ARKIV_ACCESS_KEY || "",
  arkivWriter: process.env.ARKIV_WRITER_ADDRESS || "",
};
if (!env.agentId || !env.agentKey) throw new Error("Missing AGENT_ACCOUNT_ID / AGENT_PRIVATE_KEY in .env");
if (!env.apiKey) console.warn("[agent] DEMO_AGENT_KEY is empty: run `npm run seed` and copy the key into .env");

function parseKey(k: string): PrivateKey {
  try { return PrivateKey.fromStringDer(k); } catch { /* */ }
  try { return PrivateKey.fromStringECDSA(k); } catch { /* */ }
  return PrivateKey.fromStringED25519(k);
}

const signer = createClientHederaSigner(env.agentId, parseKey(env.agentKey), { network: env.network });
const client = x402Client.fromConfig({
  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
  spendControls: { maxAmountPerPayment: "$5" },
});
const payFetch = wrapFetchWithPayment(fetch, client);

// Scenario -> merchant slug. "over-limit" calls a 0.60 USDC merchant against a 0.50 cap.
const SLUG: Record<string, string> = Object.fromEntries(DEMO_SCENARIOS.map((s) => [s.id, s.id === "over-limit" ? "premium-data" : s.id]));

/* ------------------------------ Arkiv read (optional) ------------------------------ */
type Rep = { score: string | number; totalCalls: bigint | number; failedCalls: bigint | number; $key?: string } | null;
async function readArkiv(merchantId: string): Promise<{ ok: boolean; rep: Rep; detail: string }> {
  if (!env.arkivWriter) return { ok: false, rep: null, detail: "Arkiv not configured (ARKIV_WRITER_ADDRESS empty)" };
  try {
    const [{ createPublicClient }, { rabdi }, { defineSchema, dec, str, u64 }, { eq }, { http }] = await Promise.all([
      import("@arkiv-network/sdk"), import("@arkiv-network/sdk/chains"), import("@arkiv-network/sdk/schema"), import("@arkiv-network/sdk/query"), import("viem"),
    ]);
    const chain = rabdi({ accessKey: env.arkivAccessKey });
    const read = createPublicClient({ chain, transport: http() });
    const Schema = defineSchema("agent-payment-protection.merchant-reputation.v1", {
      merchantId: str().indexed(), slug: str().indexed(), score: dec().indexed(), totalCalls: u64(), failedCalls: u64(), updatedAt: u64(),
    });
    const { entities } = await read.select({ $key: true, score: true, totalCalls: true, failedCalls: true }).from(Schema)
      .where(eq("merchantId", merchantId)).ownedBy(env.arkivWriter as `0x${string}`).fetch();
    const rep = (entities[0] as unknown as Rep) ?? null;
    return { ok: true, rep, detail: rep ? `score ${String(rep.score)} (${String(rep.totalCalls)} calls, ${String(rep.failedCalls)} failed)` : "No reputation entity yet (new merchant)" };
  } catch (err) {
    return { ok: false, rep: null, detail: `Arkiv read failed: ${String((err as Error).message ?? err).slice(0, 120)}` };
  }
}

/* ------------------------------------ run ------------------------------------------ */
const app = new Hono();
app.use("*", cors({ origin: env.webOrigin }));

app.get("/health", (c) => c.json({ ok: true, agent: env.agentId, gateway: env.gatewayUrl }));

app.get("/status", async (c) => {
  const r = await fetch(`${env.mirror}/api/v1/accounts/${env.agentId}/tokens?token.id=${env.usdc}`, { signal: AbortSignal.timeout(8000) });
  const j = r.ok ? ((await r.json()) as { tokens: { balance: number }[] }) : { tokens: [] };
  const balance = j.tokens[0]?.balance ?? 0;
  return c.json({ account: env.agentId, usdcMicro: String(balance), usdc: formatUsdc(balance), hashscan: `${env.hashscan}/account/${env.agentId}` });
});

app.post("/run", async (c) => {
  const { scenario } = (await c.req.json().catch(() => ({}))) as { scenario?: string };
  const slug: string | undefined = scenario ? SLUG[scenario] : undefined;
  if (!slug) return c.json({ error: "unknown_scenario", scenarios: DEMO_SCENARIOS.map((s) => s.id) }, 400);

  const steps: DemoStep[] = [
    { key: "reputation", label: "Checked merchant reputation on Arkiv", state: "running" },
    { key: "policy", label: "Checked spending limits", state: "pending" },
    { key: "agent_pay", label: "Agent paid the gateway", state: "pending" },
    { key: "merchant_pay", label: "Gateway paid the merchant and called it", state: "pending" },
    { key: "checks", label: "Response checked", state: "pending" },
    { key: "outcome", label: "Outcome", state: "pending" },
    { key: "hcs", label: "Receipt written to HCS", state: "pending" },
  ];
  const set = (key: string, patch: Partial<DemoStep>) => Object.assign(steps.find((s) => s.key === key)!, patch);
  const result: DemoRunResult = { scenario: scenario!, outcome: "error", paymentId: null, steps, gatewayStatus: null, gatewayResponse: null };

  // 1. merchant info + Arkiv
  const info = await fetch(`${env.gatewayUrl}/v1/merchants/${slug}`).then((r) => r.ok ? r.json() : null).catch(() => null) as
    { id: string; price: string; total: string; score: number | null } | null;
  if (!info) { set("reputation", { state: "failed", detail: "Merchant not found at gateway" }); return c.json(result, 200); }
  const rep = await readArkiv(info.id);
  set("reputation", { state: rep.ok ? "done" : "skipped", detail: rep.detail, link: rep.rep?.$key ? `https://rabdi.explorer.arkiv.network/entity/${rep.rep.$key}` : undefined });

  // 2-6. one paid request through the gateway
  set("policy", { state: "running" });
  let res: Response;
  try {
    res = await payFetch(`${env.gatewayUrl}/v1/call/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-key": env.apiKey },
      body: JSON.stringify({ query: "hbar-price", at: Date.now() }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    set("policy", { state: "failed", detail: msg.slice(0, 200) });
    result.error = msg;
    return c.json(result, 200);
  }
  result.gatewayStatus = res.status;
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  result.gatewayResponse = body;

  if (res.status === 401 || res.status === 403 || res.status === 202) {
    set("policy", { state: "failed", detail: `Blocked before payment: ${String(body?.error)}` });
    for (const k of ["agent_pay", "merchant_pay", "checks", "outcome", "hcs"]) set(k, { state: "skipped" });
    result.outcome = "blocked";
    return c.json(result, 200);
  }
  set("policy", { state: "done", detail: `Allowed: ${formatUsdc(info.total)} (price ${formatUsdc(info.price)} + fee)` });

  const header = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let agentTx: string | null = null;
  if (header) { try { agentTx = decodePaymentResponseHeader(header).transaction ?? null; } catch { /* */ } }
  set("agent_pay", agentTx
    ? { state: "done", detail: `Paid ${formatUsdc(info.total)} to the gateway`, link: hashscanTx(agentTx, env.hashscan) }
    : { state: res.status === 200 || res.status === 502 ? "done" : "failed", detail: "Settled (tx id on receipt)" });

  result.paymentId = (body?.paymentId as string) ?? null;
  if (res.status === 200) {
    set("merchant_pay", { state: "done", detail: `Gateway paid ${formatUsdc(info.price)}` });
    set("checks", { state: "done", detail: "Status, body, format and schema all passed" });
    set("outcome", { state: "done", detail: "Delivered" });
    result.outcome = "delivered";
  } else if (res.status === 502) {
    const fc = body?.faultCase as string | undefined;
    set("merchant_pay", fc === "B" ? { state: "done", detail: "Merchant failed before settling: it was never paid" } : fc === "C" ? { state: "failed", detail: "Gateway error (our fault)" } : { state: "done", detail: `Gateway paid ${formatUsdc(info.price)}` });
    set("checks", { state: "failed", detail: `Failed: ${String(body?.reason)}${body?.detail ? ` (${String(body.detail)})` : ""}` });
    set("outcome", { state: "running", detail: `Refund of ${formatUsdc(String(body?.refundAmount ?? "0"))} in progress${fc === "A" ? ", merchant bond will be slashed" : ""}` });
    result.outcome = "refund_pending";
  } else {
    set("merchant_pay", { state: "failed", detail: `Gateway returned ${res.status}` });
    result.error = JSON.stringify(body);
  }
  set("hcs", { state: "pending", detail: "Pending (worker)" });
  return c.json(result, 200);
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`demo agent listening on http://localhost:${info.port}  account=${env.agentId} gateway=${env.gatewayUrl}`);
});
