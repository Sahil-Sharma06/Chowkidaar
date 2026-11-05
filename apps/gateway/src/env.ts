import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Relative paths in .env are relative to the repo root, whatever the process cwd is.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fromRoot = (p: string) => (isAbsolute(p) || p === ":memory:" ? p : resolve(REPO_ROOT, p));

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}
const opt = (name: string, d = "") => process.env[name] || d;

export const env = {
  network: opt("HEDERA_NETWORK", "hedera:testnet") as "hedera:testnet" | "hedera:mainnet",
  mirrorUrl: opt("MIRROR_URL", "https://testnet.mirrornode.hedera.com"),
  facilitatorUrl: opt("FACILITATOR_URL", "https://api.testnet.blocky402.com"),
  usdc: opt("USDC_TOKEN_ID", "0.0.429274"),

  gatewayId: req("GATEWAY_ACCOUNT_ID"),
  gatewayKey: req("GATEWAY_PRIVATE_KEY"),
  vaultId: req("VAULT_ACCOUNT_ID"),
  vaultKey: req("VAULT_PRIVATE_KEY"),
  hcsTopicId: opt("HCS_TOPIC_ID"),

  arkivAccessKey: opt("ARKIV_ACCESS_KEY"),
  arkivPrivateKey: opt("ARKIV_PRIVATE_KEY"),
  // Public address whose entities we trust; must match ARKIV_PRIVATE_KEY's account.
  arkivWriterAddress: opt("ARKIV_WRITER_ADDRESS"),

  worldAppId: opt("WORLD_APP_ID"),
  worldRpId: opt("WORLD_RP_ID"),
  worldSigningKey: opt("WORLD_RP_SIGNING_KEY"),
  worldEnv: opt("WORLD_ENVIRONMENT", "staging") as "staging" | "production",

  jwtSecret: opt("JWT_SECRET", "dev-secret-change-me"),
  dbPath: fromRoot(opt("DATABASE_PATH", "./data/app.db")),
  feeBps: Number(opt("FEE_BPS", "200")),
  penaltyBps: Number(opt("PENALTY_BPS", "2000")),
  demoMode: opt("DEMO_MODE", "true") === "true",
  port: Number(opt("GATEWAY_PORT", "4000")),
  publicUrl: opt("GATEWAY_URL", "http://localhost:4000"),
  webOrigin: opt("WEB_ORIGIN", "http://localhost:3000"),
  // Dev only: forward non-API requests to the Next.js dev server (tunnel pointed at the gateway).
  webDevProxy: opt("WEB_DEV_PROXY"),
  hashscan: opt("NEXT_PUBLIC_HASHSCAN_URL", "https://hashscan.io/testnet"),
};

export const hasArkiv = () => Boolean(env.arkivPrivateKey);
export const hasWorld = () => Boolean(env.worldRpId && env.worldSigningKey);
export const hasHcs = () => Boolean(env.hcsTopicId);
