import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { proxy } from "hono/proxy";
import type { FacilitatorClient } from "@x402/core/server";
import type { Db } from "./db/index.ts";
import { env } from "./env.ts";
import { checkPolicy, type PolicyOk } from "./policy.ts";
import { buildX402Middleware, requestStore } from "./x402.ts";
import { makeCallHandler, type PipelineDeps } from "./pipeline.ts";
import { publicRoutes } from "./routes/public.ts";
import { authRoutes } from "./routes/auth.ts";
import { agentRoutes } from "./routes/agents.ts";
import { merchantRoutes } from "./routes/merchants.ts";
import { v1Routes } from "./routes/v1.ts";

export interface AppDeps extends PipelineDeps {
  facilitator: FacilitatorClient;
  syncFacilitatorOnStart?: boolean;
  quiet?: boolean;
}

// ponytail: in-memory per-key limiter; swap for a store if the gateway ever runs >1 process.
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c: Context, next: Next) => {
    const key = c.req.header("x-agent-key") ?? c.req.header("x-forwarded-for") ?? "anon";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return c.json({ error: "rate_limited" }, 429);
    await next();
  };
}

export function createApp(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono<{ Variables: { policy: PolicyOk } }>();

  if (!deps.quiet) app.use(logger());
  app.use("*", cors({ origin: env.webOrigin, credentials: true }));
  app.get("/health", (c) => c.json({ ok: true, network: env.network, gateway: env.gatewayId }));

  // --- Agent API -------------------------------------------------------------------
  app.use("/v1/*", (c, next) => requestStore.run({}, next)); // must be first
  app.use("/v1/call/*", rateLimit(60, 60_000));

  // Policy runs before any money moves, for both the unpaid 402 and the paid request.
  app.use("/v1/call/:slug", async (c, next) => {
    const r = checkPolicy(db, {
      apiKey: c.req.header("x-agent-key"),
      slug: c.req.param("slug"),
      approvalId: c.req.header("x-approval-id"),
    });
    if (!r.ok) {
      const body: Record<string, unknown> = { error: r.code };
      if (r.approvalId) { body.approvalId = r.approvalId; body.expiresAt = r.expiresAt; }
      return c.json(body, r.status);
    }
    c.set("policy", r);
    await next();
  });

  const { middleware } = buildX402Middleware(db, deps.facilitator, deps.syncFacilitatorOnStart ?? true);
  app.use("/v1/call/*", middleware);
  app.post("/v1/call/:slug", makeCallHandler(deps));
  app.route("/v1", v1Routes(db));

  // --- Management + public API -------------------------------------------------------
  app.route("/api", authRoutes(db));
  app.route("/api", agentRoutes(db));
  app.route("/api", merchantRoutes(db));
  app.route("/api/public", publicRoutes(db));

  // Development only: when the public tunnel (ngrok) points at the gateway instead of the web app,
  // pass every page request through to Next.js so the site and the session cookie share one origin.
  if (env.webDevProxy) {
    const target = env.webDevProxy.replace(/\/$/, "");
    app.all("*", (c) => {
      const url = new URL(c.req.url);
      // Never forward API paths: Next rewrites /api back to the gateway, which would loop.
      if (/^\/(api|v1)(\/|$)/.test(url.pathname)) return c.json({ error: "not_found" }, 404);
      return proxy(`${target}${url.pathname}${url.search}`, { raw: c.req.raw });
    });
  }

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error", detail: env.demoMode ? String(err) : undefined }, 500);
  });

  return app;
}
