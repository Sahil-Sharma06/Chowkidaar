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

const PRICE_SCHEMA = {
  type: "object",
  required: ["symbol", "price"],
  properties: { symbol: { type: "string" }, price: { type: "number" }, source: { type: "string" }, ts: { type: "number" } },
};

const DEMO = [
  { slug: "good-data", name: "HBAR Price Feed", price, timeoutMs: 10_000 },
  { slug: "server-error", name: "Crashy Quotes", price, timeoutMs: 10_000 },
  { slug: "empty-response", name: "Silent Oracle", price, timeoutMs: 10_000 },
  { slug: "broken-format", name: "HTML Not JSON Co.", price, timeoutMs: 10_000 },
  { slug: "slow-service", name: "Sleepy Data", price, timeoutMs: 5_000 },
  { slug: "honest-error", name: "Honest Failure API", price, timeoutMs: 10_000 },
  { slug: "wrong-value", name: "Confidently Wrong Data", price, timeoutMs: 10_000 },
  { slug: "premium-data", name: "Premium Price Feed", price: 600_000, timeoutMs: 10_000 },
];

// Demo owner + agent --------------------------------------------------------------------
let owner = db.select().from(accounts).where(eq(accounts.worldNullifier, "seed:demo-owner")).get();
if (!owner) {
  owner = { id: newId("acct"), role: "owner", worldAction: "seed", worldNullifier: "seed:demo-owner", createdAt: Date.now() };
  db.insert(accounts).values(owner).run();
}
let agent = db.select().from(agents).where(eq(agents.hederaAccountId, agentAccount)).get();
let apiKey: string | null = null;
if (!agent) {
  apiKey = e.DEMO_AGENT_KEY || `apk_${randomBytes(24).toString("base64url")}`;
  const id = newId("agt");
  db.insert(agents).values({
    id, ownerId: owner.id, name: "Demo research agent", hederaAccountId: agentAccount, apiKeyHash: sha256(apiKey),
    perCallCap: parseUsdc("0.50"), dailyCap: parseUsdc("5"), approvalThreshold: parseUsdc("0.50"), minScore: 60, allowlistOnly: true,
  }).run();
  agent = db.select().from(agents).where(eq(agents.id, id)).get()!;
} else if (e.DEMO_AGENT_KEY) {
  db.update(agents).set({ apiKeyHash: sha256(e.DEMO_AGENT_KEY) }).where(eq(agents.id, agent.id)).run();
  apiKey = e.DEMO_AGENT_KEY;
}

// Merchants ------------------------------------------------------------------------------
const ids: string[] = [];
for (const d of DEMO) {
  let m = db.select().from(merchants).where(eq(merchants.slug, d.slug)).get();
  if (!m) {
    const id = newId("mer");
    db.insert(merchants).values({
      id, slug: d.slug, name: d.name, endpointUrl: `${merchantsUrl}/m/${d.slug}`, payoutAccountId: payout,
      price: d.price, timeoutMs: d.timeoutMs, responseSchema: PRICE_SCHEMA, status: "needs_bond",
    }).run();
    m = db.select().from(merchants).where(eq(merchants.id, id)).get()!;
  } else {
    db.update(merchants).set({ endpointUrl: `${merchantsUrl}/m/${d.slug}`, payoutAccountId: payout }).where(eq(merchants.id, m.id)).run();
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
    dep = await fundBond(id, amount);
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
