/**
 * SkyCast: a real x402 merchant on Hedera, independent of the gateway.
 *
 * It sells live weather (Open-Meteo, no API key) for USDC, with its own Hedera payout account.
 * Nothing here knows about Chowkidaar: it is an ordinary x402 seller, and it joins the gateway
 * the way any outside merchant would, through the merchant setup page and a bond.
 *
 * It uses the "authorization" flow: the payment settles only when the handler succeeds, so a
 * failed lookup is never charged and the agent's refund comes from the gateway, not the bond.
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
  payTo: process.env.WEATHER_ACCOUNT_ID || "",
  port: Number(process.env.WEATHER_PORT || 4300),
  price: process.env.WEATHER_PRICE_MICRO || "10000", // 0.01 USDC
  defaultCity: process.env.WEATHER_DEFAULT_CITY || "Bengaluru",
};
if (!env.payTo) throw new Error("Missing WEATHER_ACCOUNT_ID in .env (run `npm run setup` to create it)");

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: env.facilitator }))
  .register("hedera:*", new ExactHederaScheme({ defaultAssets: { [env.network]: { asset: env.usdc, decimals: 6 } } }));

// WMO weather codes used by Open-Meteo.
const CONDITIONS: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "heavy rain showers", 82: "violent rain showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

const STOP = new Set(["what", "whats", "what's", "is", "the", "weather", "forecast", "temperature", "temp", "like", "now", "right",
  "today", "in", "at", "for", "of", "me", "tell", "get", "show", "how", "hot", "cold", "it", "outside", "please", "rain", "raining", "will"]);

/** "what's the weather in New Delhi?" -> ["New Delhi", "New", "Delhi"]: the phrase after in/at/for first, then single words. */
export function placeCandidates(query: string): string[] {
  const out: string[] = [];
  const after = query.match(/\b(?:in|at|for)\s+([\p{L}][\p{L}\s.'-]*)/iu)?.[1];
  if (after) out.push(after.replace(/[?.!]+$/, "").replace(/\b(today|now|tomorrow|right now|please)\b/gi, "").trim());
  for (const w of query.split(/[^\p{L}'-]+/u)) if (w.length > 2 && !STOP.has(w.toLowerCase())) out.push(w);
  return [...new Set(out.filter(Boolean))];
}

type Place = { name: string; country: string; latitude: number; longitude: number; timezone: string };

async function geocode(name: string): Promise<Place | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`geocoding ${r.status}`);
  return ((await r.json()) as { results?: Place[] }).results?.[0] ?? null;
}

async function weatherFor(query: string) {
  let place: Place | null = null;
  for (const name of [...placeCandidates(query), env.defaultCity]) if ((place = await geocode(name))) break;
  if (!place) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto";
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`forecast ${r.status}`);
  const c = ((await r.json()) as { current: Record<string, number | string> }).current;
  return {
    city: place.name, country: place.country, latitude: place.latitude, longitude: place.longitude,
    temperatureC: Number(c.temperature_2m), feelsLikeC: Number(c.apparent_temperature),
    humidityPct: Number(c.relative_humidity_2m), windKph: Number(c.wind_speed_10m),
    conditions: CONDITIONS[Number(c.weather_code)] ?? `code ${c.weather_code}`,
    observedAt: String(c.time), timezone: place.timezone, source: "open-meteo.com",
  };
}

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true, merchant: "skycast", payTo: env.payTo, price: env.price }));

app.use(paymentMiddleware({
  "POST /weather": {
    accepts: {
      scheme: "exact", network: env.network, payTo: env.payTo,
      price: { amount: env.price, asset: env.usdc }, maxTimeoutSeconds: 120,
    },
    description: "Live weather for any city, from Open-Meteo",
  },
}, resourceServer));

app.post("/weather", async (c) => {
  const body = await c.req.json<{ query?: string; city?: string }>().catch(() => ({} as { query?: string; city?: string }));
  try {
    const w = await weatherFor(body.city ?? body.query ?? "");
    return w ? c.json(w) : c.json({ error: "place_not_found" }, 404);
  } catch (err) {
    console.warn("[skycast] upstream failed:", err);
    return c.json({ error: "weather_unavailable" }, 503);
  }
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`SkyCast weather merchant on http://localhost:${info.port}/weather  payTo=${env.payTo} price=${env.price} facilitator=${env.facilitator}`);
});
