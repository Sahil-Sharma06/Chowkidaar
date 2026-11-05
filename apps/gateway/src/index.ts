import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db/index.ts";
import { env, hasArkiv, hasHcs, hasWorld } from "./env.ts";
import { callMerchantLive } from "./pipeline.ts";
import { gatewayPaidMerchant } from "./chain/mirror.ts";
import { buildFacilitator } from "./x402.ts";
import { recoverStuckPayments, startWorker } from "./worker.ts";

const { db } = openDb(env.dbPath);

const recovered = recoverStuckPayments(db);
if (recovered) console.log(`[startup] recovered ${recovered} stuck payment(s) as case C`);

const app = createApp({
  db,
  facilitator: buildFacilitator(),
  callMerchant: callMerchantLive,
  gatewayPaidMerchant: (m, since) => gatewayPaidMerchant(m.payoutAccountId, since, m.price),
  chainCheckDelayMs: 6000,
});

startWorker(db);

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`gateway listening on http://localhost:${info.port}`);
  console.log(`  network=${env.network} facilitator=${env.facilitatorUrl}`);
  console.log(`  gateway=${env.gatewayId} vault=${env.vaultId} usdc=${env.usdc}`);
  console.log(`  hcs=${hasHcs() ? env.hcsTopicId : "off"} arkiv=${hasArkiv() ? "on" : "off"} world=${hasWorld() ? "on" : "off (dev login)"} demoMode=${env.demoMode}`);
});
