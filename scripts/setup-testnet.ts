/**
 * One-time testnet setup: associate USDC with every account and create the HCS topic.
 * Safe to re-run. Prints the env lines to paste into .env.
 */
import { AccountCreateTransaction, Client, Hbar, PrivateKey, TokenAssociateTransaction, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USDC = process.env.USDC_TOKEN_ID || "0.0.429274";
const MIRROR = process.env.MIRROR_URL || "https://testnet.mirrornode.hedera.com";

function parseKey(k: string): PrivateKey {
  try { return PrivateKey.fromStringDer(k); } catch { /* */ }
  try { return PrivateKey.fromStringECDSA(k); } catch { /* */ }
  return PrivateKey.fromStringED25519(k);
}

async function isAssociated(accountId: string) {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${accountId}/tokens?token.id=${USDC}`);
  if (!r.ok) return false;
  const j = (await r.json()) as { tokens: unknown[] };
  return j.tokens.length > 0;
}

async function associate(label: string, accountId: string, key: string) {
  if (!accountId || !key) { console.log(`- ${label}: skipped (not in .env)`); return; }
  if (await isAssociated(accountId)) { console.log(`- ${label} ${accountId}: already associated with USDC`); return; }
  const pk = parseKey(key);
  const client = Client.forTestnet().setOperator(accountId, pk);
  try {
    const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([USDC]).freezeWith(client).sign(pk);
    const receipt = await (await tx.execute(client)).getReceipt(client);
    console.log(`- ${label} ${accountId}: associate USDC -> ${receipt.status.toString()}`);
  } catch (err) {
    console.log(`- ${label} ${accountId}: ${String(err)}`);
  } finally {
    client.close();
  }
}

async function createTopic() {
  if (process.env.HCS_TOPIC_ID) { console.log(`- HCS topic already set: ${process.env.HCS_TOPIC_ID}`); return process.env.HCS_TOPIC_ID; }
  const key = parseKey(process.env.GATEWAY_PRIVATE_KEY!);
  const client = Client.forTestnet().setOperator(process.env.GATEWAY_ACCOUNT_ID!, key);
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("agent-payment-protection receipts v1")
    .setSubmitKey(key.publicKey) // only the gateway can write receipts
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const id = receipt.topicId!.toString();
  console.log(`- created HCS topic ${id}  https://hashscan.io/testnet/topic/${id}`);
  client.close();
  return id;
}

async function balances(label: string, accountId?: string) {
  if (!accountId) return;
  const [a, t] = await Promise.all([
    fetch(`${MIRROR}/api/v1/accounts/${accountId}`).then((r) => r.json() as Promise<{ balance: { balance: number } }>),
    fetch(`${MIRROR}/api/v1/accounts/${accountId}/tokens?token.id=${USDC}`).then((r) => r.json() as Promise<{ tokens: { balance: number }[] }>),
  ]);
  const hbar = (a.balance?.balance ?? 0) / 1e8;
  const usdc = (t.tokens?.[0]?.balance ?? 0) / 1e6;
  console.log(`  ${label.padEnd(9)} ${accountId.padEnd(12)} ${hbar.toFixed(2).padStart(10)} HBAR ${usdc.toFixed(6).padStart(14)} USDC`);
}

const e = process.env;
const created: string[] = [];

/** The portal gives one account per profile; create the others from the gateway account. */
async function ensureAccount(label: string, idVar: string, keyVar: string, hbar: number) {
  if (e[idVar] && e[keyVar]) return;
  if (!e.GATEWAY_ACCOUNT_ID || !e.GATEWAY_PRIVATE_KEY) throw new Error("GATEWAY_ACCOUNT_ID and GATEWAY_PRIVATE_KEY are required in .env");
  const client = Client.forTestnet().setOperator(e.GATEWAY_ACCOUNT_ID, parseKey(e.GATEWAY_PRIVATE_KEY));
  const key = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(key)
    .setInitialBalance(new Hbar(hbar))
    .setMaxAutomaticTokenAssociations(-1)
    .setAccountMemo(`agent-payment-protection ${label}`)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const id = receipt.accountId!.toString();
  client.close();
  e[idVar] = id;
  e[keyVar] = key.toStringDer();
  created.push(`${idVar}=${id}`, `${keyVar}=${key.toStringDer()}`);
  console.log(`- created ${label} account ${id} with ${hbar} HBAR`);
}

console.log("Accounts");
await ensureAccount("vault", "VAULT_ACCOUNT_ID", "VAULT_PRIVATE_KEY", 10);
await ensureAccount("agent", "AGENT_ACCOUNT_ID", "AGENT_PRIVATE_KEY", 10);
await ensureAccount("merchant", "MERCHANT_ACCOUNT_ID", "MERCHANT_PRIVATE_KEY", 5);

console.log("\nAssociating USDC", USDC);
await associate("gateway", e.GATEWAY_ACCOUNT_ID!, e.GATEWAY_PRIVATE_KEY!);
await associate("vault", e.VAULT_ACCOUNT_ID!, e.VAULT_PRIVATE_KEY!);
await associate("agent", e.AGENT_ACCOUNT_ID!, e.AGENT_PRIVATE_KEY!);
if (e.MERCHANT_PRIVATE_KEY) await associate("merchant", e.MERCHANT_ACCOUNT_ID!, e.MERCHANT_PRIVATE_KEY);
else console.log(`- merchant ${e.MERCHANT_ACCOUNT_ID ?? "(unset)"}: no MERCHANT_PRIVATE_KEY, make sure it is associated with USDC yourself`);

console.log("\nHCS topic");
const topic = await createTopic();

console.log("\nBalances (mirror node)");
await balances("gateway", e.GATEWAY_ACCOUNT_ID);
await balances("vault", e.VAULT_ACCOUNT_ID);
await balances("agent", e.AGENT_ACCOUNT_ID);
await balances("merchant", e.MERCHANT_ACCOUNT_ID);

// Write results straight into ../.env so nothing has to be copied by hand.
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (!process.env.HCS_TOPIC_ID) created.push(`HCS_TOPIC_ID=${topic}`);
if (created.length) {
  let text = readFileSync(envPath, "utf8");
  for (const line of created) {
    const [k, v] = line.split("=", 2) as [string, string];
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\s*$/, "")}\n${k}=${v}\n`;
  }
  writeFileSync(envPath, text);
  console.log(`\nWrote ${created.length} line(s) into .env: ${created.map((l) => l.split("=")[0]).join(", ")}`);
}
console.log("\nFunding checklist: gateway needs HBAR (refund/HCS gas) + USDC (pays merchants); agent needs USDC; vault needs USDC (bonds, or run seed with SEED_FUND_FROM_GATEWAY=true).");
