/**
 * Seeds the gateway database with a demo owner, one agent and the eight demo merchants.
 *
 * Bonds: with SEED_FUND_FROM_GATEWAY=true the gateway account makes a REAL USDC transfer
 * into the vault for each merchant (memo bond:<id>), verifies it on the mirror node and
 * credits the ledger. Otherwise the ledger is credited without an on-chain deposit and
 * the vault must already hold at least the total (DEMO ONLY, printed as a warning).
 */
import { eq } from "drizzle-orm";
import { Client, PrivateKey, TokenId, TransferTransaction } from "@hiero-ledger/sdk";
import { createHash, randomBytes } from "node:crypto";
import { parseUsdc, toMirrorTxId } from "@app/shared";
import { openDb, schema } from "../apps/gateway/src/db/index.ts";

const e = process.env;
const need = (k: string) => { const v = e[k]; if (!v) throw new Error(`Missing ${k} in .env`); return v; };

const dbPath = e.DATABASE_PATH || "./data/app.db";
const merchantsUrl = e.MERCHANTS_URL || "http://localhost:4100";
const payout = need("MERCHANT_ACCOUNT_ID");
const agentAccount = need("AGENT_ACCOUNT_ID");
const price = parseUsdc(e.DEMO_PRICE_USDC || "0.10");
const bondEach = parseUsdc(e.SEED_BOND_USDC || "1.5");
const fund = e.SEED_FUND_FROM_GATEWAY === "true";
const penaltyBps = Number(e.PENALTY_BPS || 2000);

const { db } = openDb(dbPath.startsWith("./") ? `../${dbPath.slice(2)}` : dbPath);
const { accounts, agents, merchants, allowedMerchants, bondLedger } = schema;
const newId = (p: string) => `${p}_${randomBytes(9).toString("base64url")}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const schemaOf = (required: string[]) => ({ type: "object", required, properties: Object.fromEntries(required.map((k) => [k, {}])) });
const FOOD = schemaOf(["orderId", "item", "eta", "status"]);
const MUSIC = schemaOf(["track", "artist", "url"]);
const RIDE = schemaOf(["rideId", "driver", "eta", "status"]);
const PRICE = { type: "object", required: ["symbol", "price"], properties: { symbol: { type: "string" }, price: { type: "number" }, source: { type: "string" }, ts: { type: "number" } } };

/**
 * The demo catalog. Each entry is a real x402 seller in apps/demo-merchants that looks like an
 * everyday service; `description` says, in plain words, how it behaves. `was` is the slug the
 * same merchant had in an earlier seed, so re-seeding renames it in place and keeps its bond
 * and Arkiv reputation instead of creating a duplicate.
 */
const DEMO = [
  { slug: "burgerbot", name: "BurgerBot Kitchen", category: "food", keywords: ["burger", "fries", "lunch", "dinner", "hungry", "meal", "order", "eat"], samplePrompt: "Get me a burger", description: "Demo kitchen that confirms your order. Expect: delivered.", price, timeoutMs: 10_000, schema: FOOD },
  { slug: "dodgy-diner", was: "server-error", name: "Dodgy Diner", category: "food", keywords: ["burger", "pizza", "dinner", "meal", "order", "eat"], description: "Takes your money, then its kitchen crashes (HTTP 500). Expect: refund, bond slashed.", price, timeoutMs: 10_000, schema: FOOD },
  { slug: "mystery-meals", was: "wrong-value", name: "Mystery Meals", category: "food", keywords: ["meal", "food", "order", "eat"], description: "Confirms with a well-formed but nonsense order. Expect: delivered (our known limit).", price, timeoutMs: 10_000, schema: FOOD },
  { slug: "vip-table", was: "big-ticket", name: "VIP Table", category: "food", keywords: ["table", "reservation", "restaurant", "tasting", "date"], samplePrompt: "Book a chef's table for two tonight", description: "0.30 USDC: above the demo agent's approval threshold. Expect: held until the owner approves.", price: 300_000, timeoutMs: 10_000, schema: FOOD },
  { slug: "streamtune", name: "StreamTune", category: "music", keywords: ["music", "song", "track", "play", "playlist", "stream", "listen"], samplePrompt: "Play me some music", description: "Demo label that streams a track. Expect: delivered.", price, timeoutMs: 10_000, schema: MUSIC },
  { slug: "silent-dj", was: "empty-response", name: "Silent DJ", category: "music", keywords: ["music", "song", "track", "play", "listen"], description: "Takes your money and returns nothing. Expect: refund, bond slashed.", price, timeoutMs: 10_000, schema: MUSIC },
  { slug: "lofi-radio", was: "broken-format", name: "Lo-fi Radio", category: "music", keywords: ["music", "radio", "play", "listen"], description: "Returns an HTML page instead of JSON. Expect: refund, bond slashed.", price, timeoutMs: 10_000, schema: MUSIC },
  { slug: "quickcab", was: "slow-service", name: "QuickCab", category: "rides", keywords: ["cab", "taxi", "ride", "car", "airport", "drive", "pickup"], samplePrompt: "Book me a cab to the airport", description: "Confirms your ride after 30 seconds, past the 5 s timeout. Expect: refund after timeout.", price, timeoutMs: 5_000, schema: RIDE },
  { slug: "honest-cab", was: "honest-error", name: "Honest Cab", category: "rides", keywords: ["cab", "taxi", "ride", "car", "drive"], description: "Fails before settling, so it is never paid. Expect: refund, no slash.", price, timeoutMs: 10_000, schema: RIDE },
  { slug: "hbar-price", was: "good-data", name: "HBAR Price Feed", category: "data", keywords: ["hbar", "price", "quote", "market", "rate", "crypto", "hedera", "usd"], samplePrompt: "What's the HBAR price right now?", description: "Live HBAR/USD from CoinGecko. Expect: delivered.", price, timeoutMs: 10_000, schema: PRICE },
  { slug: "premium-feed", was: "premium-data", name: "Premium Price Feed", category: "data", keywords: ["hbar", "price", "quote", "premium"], description: "Same data at 0.60 USDC: above the demo agent's per-call cap. Expect: blocked before payment.", price: 600_000, timeoutMs: 10_000, schema: PRICE },
] as const;
const APPROVAL_THRESHOLD = parseUsdc(e.DEMO_APPROVAL_USDC || "0.25");

// Demo owner + agent --------------------------------------------------------------------
let owner = db.select().from(accounts).where(eq(accounts.worldNullifier, "seed:demo-owner")).get();
if (!owner) {
  // Sandbox-only owner: it can never sign in (no World ID identity), it only owns the demo agent.
  db.insert(accounts).values({ id: newId("acct"), isOwner: true, displayName: "Sandbox owner", worldAction: "seed", worldNullifier: "seed:demo-owner" }).run();
  owner = db.select().from(accounts).where(eq(accounts.worldNullifier, "seed:demo-owner")).get()!;
}
let agent = db.select().from(agents).where(eq(agents.hederaAccountId, agentAccount)).get();
let apiKey: string | null = null;
if (!agent) {
  apiKey = e.DEMO_AGENT_KEY || `apk_${randomBytes(24).toString("base64url")}`;
  const id = newId("agt");
  db.insert(agents).values({
    id, ownerId: owner.id, name: "Demo research agent", hederaAccountId: agentAccount, apiKeyHash: sha256(apiKey),
    perCallCap: parseUsdc("0.50"), dailyCap: parseUsdc("5"), approvalThreshold: APPROVAL_THRESHOLD, minScore: 60, allowlistOnly: true,
  }).run();
  agent = db.select().from(agents).where(eq(agents.id, id)).get()!;
} else {
  db.update(agents).set({ approvalThreshold: APPROVAL_THRESHOLD, ...(e.DEMO_AGENT_KEY ? { apiKeyHash: sha256(e.DEMO_AGENT_KEY) } : {}) }).where(eq(agents.id, agent.id)).run();
  apiKey = e.DEMO_AGENT_KEY || null;
}

// Merchants ------------------------------------------------------------------------------
const ids: string[] = [];
for (const d of DEMO) {
  const catalog = {
    slug: d.slug, name: d.name, endpointUrl: `${merchantsUrl}/m/${d.slug}`, payoutAccountId: payout,
    price: d.price, timeoutMs: d.timeoutMs, responseSchema: d.schema as Record<string, unknown>,
    category: d.category, keywords: [...d.keywords], description: d.description, samplePrompt: "samplePrompt" in d ? d.samplePrompt : null,
  };
  let m = db.select().from(merchants).where(eq(merchants.slug, d.slug)).get()
    ?? ("was" in d ? db.select().from(merchants).where(eq(merchants.slug, d.was)).get() : undefined);
  if (!m) {
    const id = newId("mer");
    db.insert(merchants).values({ id, ...catalog, status: "needs_bond" }).run();
    m = db.select().from(merchants).where(eq(merchants.id, id)).get()!;
  } else {
    if (m.slug !== d.slug) console.log(`- ${m.slug} -> ${d.slug} (renamed in place, bond and reputation kept)`);
    db.update(merchants).set(catalog).where(eq(merchants.id, m.id)).run();
  }
  ids.push(m.id);
  db.insert(allowedMerchants).values({ agentId: agent.id, merchantId: m.id }).onConflictDoNothing().run();
}

// Bonds ----------------------------------------------------------------------------------
async function fundBond(merchantId: string, amount: number): Promise<{ amount: number; txId: string }> {
  const key = (() => { const k = need("GATEWAY_PRIVATE_KEY"); try { return PrivateKey.fromStringDer(k); } catch { try { return PrivateKey.fromStringECDSA(k); } catch { return PrivateKey.fromStringED25519(k); } } })();
  const client = Client.forTestnet().setOperator(need("GATEWAY_ACCOUNT_ID"), key);
  const usdc = TokenId.fromString(e.USDC_TOKEN_ID || "0.0.429274");
  const tx = await new TransferTransaction()
    .addTokenTransfer(usdc, need("GATEWAY_ACCOUNT_ID"), -amount)
    .addTokenTransfer(usdc, need("VAULT_ACCOUNT_ID"), amount)
    .setTransactionMemo(`bond:${merchantId}`)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  client.close();
  if (receipt.status.toString() !== "SUCCESS") throw new Error(`bond transfer ${receipt.status}`);
  const txId = toMirrorTxId(tx.transactionId.toString());
  // wait for the mirror node, then verify like a real deposit would be
  const mirror = e.MIRROR_URL || "https://testnet.mirrornode.hedera.com";
  for (let i = 0; i < 15; i++) {
    const r = await fetch(`${mirror}/api/v1/transactions/${txId}`);
    if (r.ok) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { amount, txId };
}

for (const id of ids) {
  const m = db.select().from(merchants).where(eq(merchants.id, id)).get()!;
  const minBond = 10 * (m.price + Math.floor((m.price * penaltyBps) / 10_000));
  const target = Math.max(bondEach, minBond);
  if (m.bondBalance >= target) { console.log(`- ${m.slug.padEnd(15)} bond ok (${m.bondBalance} micro)`); if (m.status === "needs_bond") db.update(merchants).set({ status: "live" }).where(eq(merchants.id, id)).run(); continue; }
  const amount = target - m.bondBalance;
  let dep: { amount: number; txId: string | null };
  if (fund) {
    try {
      dep = await fundBond(id, amount);
    } catch (err) {
      console.log(`- ${m.slug.padEnd(15)} NOT funded (${String((err as Error).message).slice(0, 80)}). Top up the gateway with USDC and re-run seed.`);
      continue;
    }
    console.log(`- ${m.slug.padEnd(15)} funded bond +${amount} micro USDC  https://hashscan.io/testnet/transaction/${dep.txId}`);
  } else {
    dep = { amount, txId: null };
    console.log(`- ${m.slug.padEnd(15)} credited bond +${amount} micro USDC WITHOUT an on-chain deposit (demo only)`);
  }
  db.insert(bondLedger).values({ id: newId("led"), merchantId: id, type: "deposit", amount: dep.amount, txId: dep.txId }).run();
  db.update(merchants).set({ bondBalance: m.bondBalance + dep.amount, status: "live" }).where(eq(merchants.id, id)).run();
}

const total = db.select().from(merchants).all().reduce((s, m) => s + m.bondBalance, 0);
console.log(`\nSeeded ${ids.length} merchants, total bond ${total} micro USDC (${(total / 1e6).toFixed(2)} USDC).`);
if (!fund) console.log(`WARNING: vault ${e.VAULT_ACCOUNT_ID} must actually hold >= ${(total / 1e6).toFixed(2)} USDC or case-A refunds will fail. Re-run with SEED_FUND_FROM_GATEWAY=true to fund from the gateway account.`);
if (apiKey) console.log(`\nAgent API key (shown once). Add to .env:\nDEMO_AGENT_KEY=${apiKey}`);
else console.log("\nAgent already seeded; DEMO_AGENT_KEY unchanged.");
