/**
 * Demo merchants: real x402 sellers on Hedera testnet that look like everyday services
 * (a kitchen, a music stream, a cab, a price feed). Each one has a single deliberate
 * behaviour so every branch of the gateway's pipeline can be shown with real money.
 *
 * Which merchants exist, what they sell and how they misbehave is data (the table below);
 * the HTTP wiring is generated from it. The gateway learns about them from `npm run seed`.
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

type Behaviour = "ok" | "crash" | "empty" | "html" | "slow" | "honest" | "nonsense";
interface Demo {
  slug: string;
  describe: string;
  behaviour: Behaviour;
  /** Default: the gateway pays upfront. "authorization" settles only on success (used by "honest" failures). */
  flow?: "upfront" | "authorization";
  amount?: string;
  reply?: () => Promise<unknown> | unknown;
}

const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const food = (item: string, eta: string) => ({ orderId: id("ORD"), item, eta, status: "confirmed", kitchen: "demo kitchen, nothing is cooked" });
const ride = () => ({ rideId: id("RIDE"), driver: "Priya · Toyota Etios · KA-05", eta: "4 min", status: "confirmed", note: "demo dispatcher, no car is coming" });
const music = () => ({ track: "Midnight Ledger", artist: "The Consensus", url: "https://example.com/stream/midnight-ledger.mp3", durationSec: 214, note: "demo label, placeholder stream" });

/** Live HBAR price from CoinGecko, mirror-node exchange rate as fallback. */
async function hbarPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd", { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const usd = ((await r.json()) as { "hedera-hashgraph"?: { usd?: number } })["hedera-hashgraph"]?.usd;
      if (typeof usd === "number") return { symbol: "HBAR", price: usd, source: "coingecko", ts: Date.now() };
    }
  } catch { /* fall through */ }
  const r = await fetch("https://testnet.mirrornode.hedera.com/api/v1/network/exchangerate", { signal: AbortSignal.timeout(4000) });
  const j = (await r.json()) as { current_rate: { cent_equivalent: number; hbar_equivalent: number } };
  return { symbol: "HBAR", price: j.current_rate.cent_equivalent / j.current_rate.hbar_equivalent / 100, source: "hedera-exchange-rate", ts: Date.now() };
}

export const DEMOS: Demo[] = [
  // food
  { slug: "burgerbot", describe: "Confirms a burger order", behaviour: "ok", reply: () => food("Double cheeseburger + fries", "18 min") },
  { slug: "dodgy-diner", describe: "Takes the money, then the kitchen crashes (HTTP 500)", behaviour: "crash" },
  { slug: "mystery-meals", describe: "Confirms with a well-formed but nonsense order", behaviour: "nonsense", reply: () => ({ orderId: "???", item: "", eta: "-999 min", status: "confirmed" }) },
  { slug: "vip-table", describe: "Chef's table at 0.30 USDC", behaviour: "ok", amount: "300000", reply: () => food("Chef's tasting menu for two", "Tonight 20:00") },
  // music
  { slug: "streamtune", describe: "Streams a track", behaviour: "ok", reply: music },
  { slug: "silent-dj", describe: "Takes the money, returns an empty body", behaviour: "empty" },
  { slug: "lofi-radio", describe: "Returns an HTML page instead of JSON", behaviour: "html" },
  // rides
  { slug: "quickcab", describe: "Confirms a ride… after 30 seconds", behaviour: "slow", reply: ride },
  { slug: "honest-cab", describe: "Fails before settling, so it is never paid", behaviour: "honest", flow: "authorization" },
  // data
  { slug: "hbar-price", describe: "Live HBAR/USD price", behaviour: "ok", reply: hbarPrice },
  { slug: "premium-feed", describe: "Same price feed at 0.60 USDC", behaviour: "ok", amount: "600000", reply: async () => ({ ...(await hbarPrice()), tier: "premium" }) },
];

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: env.facilitator }))
  .register("hedera:*", new ExactHederaScheme({ defaultAssets: { [env.network]: { asset: env.usdc, decimals: 6 } } }));

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, payTo: env.payTo, price: env.price, merchants: DEMOS.map((d) => d.slug) }));

app.use(paymentMiddleware(Object.fromEntries(DEMOS.map((d) => [`POST /m/${d.slug}`, {
  accepts: {
    scheme: "exact", network: env.network, payTo: env.payTo,
    price: { amount: d.amount ?? env.price, asset: env.usdc },
    maxTimeoutSeconds: 120,
    extra: (d.flow ?? "upfront") === "upfront" ? { paymentFlow: "upfront" } : {},
  },
  description: d.describe,
}])), resourceServer));

for (const d of DEMOS) {
  app.post(`/m/${d.slug}`, async (c) => {
    switch (d.behaviour) {
      case "crash": return c.json({ error: "kitchen on fire" }, 500);
      case "honest": return c.json({ error: "no drivers available" }, 500);
      case "empty": return c.body(null, 200);
      case "html": return c.html("<html><body><h1>Now playing</h1></body></html>");
      case "slow": await new Promise((r) => setTimeout(r, 30_000)); return c.json(await d.reply!());
      default: return c.json(await d.reply!());
    }
  });
}

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`demo merchants listening on http://localhost:${info.port}  payTo=${env.payTo} price=${env.price} facilitator=${env.facilitator}`);
  console.log(`  ${DEMOS.map((d) => d.slug).join(", ")}`);
});
