/**
 * Seven real x402 sellers on Hedera testnet, each with one deliberate behaviour.
 * Every route is a genuine paid endpoint: the gateway pays USDC into MERCHANT_ACCOUNT_ID
 * before the handler runs (upfront flow), except `honest-error` which uses the default
 * authorization flow and therefore never settles when it fails.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

const env = {
  network: (process.env.HEDERA_NETWORK || "hedera:testnet") as "hedera:testnet" | "hedera:mainnet",
  facilitator: process.env.FACILITATOR_URL || "https://api.testnet.blocky402.com",
  usdc: process.env.USDC_TOKEN_ID || "0.0.429274",
  payTo: process.env.MERCHANT_ACCOUNT_ID || "",
  port: Number(process.env.MERCHANTS_PORT || 4100),
  price: process.env.DEMO_PRICE_MICRO || "100000", // 0.10 USDC
};
if (!env.payTo) throw new Error("Missing MERCHANT_ACCOUNT_ID in .env");

const option = (flow?: "upfront", amount = env.price) => ({
  scheme: "exact",
  network: env.network,
  payTo: env.payTo,
  price: { amount, asset: env.usdc },
  maxTimeoutSeconds: 120,
  extra: flow ? { paymentFlow: flow } : {},
});

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: env.facilitator }))
  .register("hedera:*", new ExactHederaScheme({ defaultAssets: { [env.network]: { asset: env.usdc, decimals: 6 } } }));

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, payTo: env.payTo, price: env.price }));

app.use(paymentMiddleware({
  "POST /m/good-data":      { accepts: option("upfront"), description: "HBAR spot price (live)" },
  "POST /m/server-error":   { accepts: option("upfront"), description: "Takes payment, then returns 500" },
  "POST /m/empty-response": { accepts: option("upfront"), description: "Takes payment, returns empty 200" },
  "POST /m/broken-format":  { accepts: option("upfront"), description: "Takes payment, returns HTML" },
  "POST /m/slow-service":   { accepts: option("upfront"), description: "Takes payment, sleeps 30s" },
  "POST /m/honest-error":   { accepts: option(),          description: "Default flow: fails without settling" },
  "POST /m/wrong-value":    { accepts: option("upfront"), description: "Valid JSON, nonsense value" },
  "POST /m/premium-data":   { accepts: option("upfront", "600000"), description: "Same data at 0.60 USDC (over-limit demo)" },
}, resourceServer));

/** Live HBAR price from CoinGecko. Falls back to the mirror node exchange rate if CoinGecko is down. */
async function hbarPrice(): Promise<{ symbol: string; price: number; source: string; ts: number }> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd", { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const j = (await r.json()) as { "hedera-hashgraph"?: { usd?: number } };
      const usd = j["hedera-hashgraph"]?.usd;
      if (typeof usd === "number") return { symbol: "HBAR", price: usd, source: "coingecko", ts: Date.now() };
    }
  } catch { /* fall through */ }
  const r = await fetch("https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate", { signal: AbortSignal.timeout(4000) });
  const j = (await r.json()) as { current_rate: { cent_equivalent: number; hbar_equivalent: number } };
  const price = j.current_rate.cent_equivalent / j.current_rate.hbar_equivalent / 100;
  return { symbol: "HBAR", price, source: "hedera-exchange-rate", ts: Date.now() };
}

app.post("/m/good-data", async (c) => c.json(await hbarPrice()));
app.post("/m/premium-data", async (c) => c.json({ ...(await hbarPrice()), tier: "premium" }));
app.post("/m/server-error", (c) => c.json({ error: "boom" }, 500));
app.post("/m/empty-response", (c) => c.body(null, 200));
app.post("/m/broken-format", (c) => c.html("<html><body><h1>Oops</h1></body></html>"));
app.post("/m/slow-service", async (c) => { await new Promise((r) => setTimeout(r, 30_000)); return c.json(await hbarPrice()); });
app.post("/m/honest-error", (c) => c.json({ error: "boom" }, 500));
app.post("/m/wrong-value", (c) => c.json({ symbol: "HBAR", price: 999_999_999, source: "nonsense", ts: Date.now() }));

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`demo merchants listening on http://localhost:${info.port}  payTo=${env.payTo} price=${env.price} facilitator=${env.facilitator}`);
});
