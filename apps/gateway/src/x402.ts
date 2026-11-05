import { AsyncLocalStorage } from "node:async_hooks";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import type { SettleResponse } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { eq } from "drizzle-orm";
import type { Db } from "./db/index.ts";
import { schema } from "./db/index.ts";
import { env } from "./env.ts";
import { totalFor } from "./money.ts";

export type RequestStore = { settlement?: SettleResponse };
export const requestStore = new AsyncLocalStorage<RequestStore>();

export function buildFacilitator(): FacilitatorClient {
  return new HTTPFacilitatorClient({ url: env.facilitatorUrl, timeoutMs: 60_000 });
}

/**
 * Agent-facing x402 middleware. The agent pays price + fee to the gateway using the
 * `upfront` flow, so the gateway holds the money before it pays the merchant.
 */
export function buildX402Middleware(db: Db, facilitator: FacilitatorClient, syncOnStart = true) {
  const resourceServer = new x402ResourceServer(facilitator)
    .register("hedera:*", new ExactHederaScheme({
      defaultAssets: { [env.network]: { asset: env.usdc, decimals: 6 } },
    }));

  resourceServer.onAfterSettle(async (ctx) => {
    const store = requestStore.getStore();
    if (store) store.settlement = ctx.result as SettleResponse;
  });

  const middleware = paymentMiddleware(
    {
      "POST /v1/call/*": {
        description: "Protected merchant call through the payment-protection gateway",
        mimeType: "application/json",
        accepts: {
          scheme: "exact",
          network: env.network,
          payTo: env.gatewayId,
          maxTimeoutSeconds: 120,
          extra: { paymentFlow: "upfront" },
          price: (ctx) => {
            const slug = ctx.path.split("/")[3] ?? "";
            const m = db.select({ price: schema.merchants.price }).from(schema.merchants)
              .where(eq(schema.merchants.slug, slug)).get();
            // Policy middleware already rejected unknown merchants; this is a fallback.
            const price = m?.price ?? 0;
            return { amount: String(totalFor(price)), asset: env.usdc };
          },
        },
      },
    },
    resourceServer,
    undefined,
    undefined,
    syncOnStart,
  );

  return { middleware, resourceServer };
}
