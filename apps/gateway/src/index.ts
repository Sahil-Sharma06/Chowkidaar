import { connect } from "node:net";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { env, hasArkiv, hasHcs, hasWorld } from "./env.ts";
import { callMerchantLive } from "./pipeline.ts";
import { gatewayPaidMerchant } from "./chain/mirror.ts";
import { buildFacilitator } from "./x402.ts";
import { recoverStuckPayments, startWorker } from "./worker.ts";
import { backfillUaids } from "./routes/agents.ts";

const { db } = openDb(env.dbPath);

const recovered = recoverStuckPayments(db);
if (recovered) console.log(`[startup] recovered ${recovered} stuck payment(s) as case C`);
void backfillUaids(db);

const app = createApp({
  db,
  facilitator: buildFacilitator(),
  callMerchant: callMerchantLive,
  gatewayPaidMerchant: (m, since) => gatewayPaidMerchant(m.payoutAccountId, since, m.price),
  chainCheckDelayMs: 6000,
});

startWorker(db);

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`gateway listening on http://localhost:${info.port}`);
  console.log(`  network=${env.network} facilitator=${env.facilitatorUrl}`);
  console.log(`  gateway=${env.gatewayId} vault=${env.vaultId} usdc=${env.usdc}`);
  if (env.webDevProxy) console.log(`  dev proxy: pages -> ${env.webDevProxy}`);
  console.log(`  hcs=${hasHcs() ? env.hcsTopicId : "off"} arkiv=${hasArkiv() ? "on" : "off"} world=${hasWorld() ? "on" : "off (dev login)"} demoMode=${env.demoMode}`);
});

// Dev proxy, part 2: Next's dev server loads code over a WebSocket (/_next/hmr). Pass upgrades through raw.
if (env.webDevProxy) {
  const target = new URL(env.webDevProxy);
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/_next/")) { socket.destroy(); return; }
    const upstream = connect(Number(target.port || 80), target.hostname, () => {
      const headers = Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`));
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => { upstream.destroy(); socket.destroy(); };
    upstream.on("error", close);
    socket.on("error", close);
  });
}
