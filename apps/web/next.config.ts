import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Next only reads .env from apps/web; the monorepo keeps one .env at the root.
try {
  for (const line of readFileSync(resolve(process.cwd(), "../../.env"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
} catch { /* no root .env */ }

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4000";
const DEMO_AGENT_URL = process.env.DEMO_AGENT_URL ?? "http://localhost:4200";

const config: NextConfig = {
  transpilePackages: ["@app/shared"],
  env: {
    NEXT_PUBLIC_HASHSCAN_URL: process.env.NEXT_PUBLIC_HASHSCAN_URL ?? "https://hashscan.io/testnet",
    NEXT_PUBLIC_WORLD_APP_ID: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? process.env.WORLD_APP_ID ?? "",
    NEXT_PUBLIC_WORLD_ENVIRONMENT: process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT ?? process.env.WORLD_ENVIRONMENT ?? "staging",
    NEXT_PUBLIC_USDC_TOKEN_ID: process.env.USDC_TOKEN_ID ?? "0.0.429274",
    NEXT_PUBLIC_GATEWAY_URL: GATEWAY_URL,
  },
  // Same-origin API calls keep the session cookie first-party.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${GATEWAY_URL}/api/:path*` },
      { source: "/demo-agent/:path*", destination: `${DEMO_AGENT_URL}/:path*` },
    ];
  },
};
export default config;
