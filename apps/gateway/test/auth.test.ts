/**
 * Accounts, server-side sessions, roles and Agent Pass step-up rules.
 * World ID itself is not called here: dev login stands in for sign-in, and step-up grants are
 * written to the session row the way the OIDC callback writes them after a fresh verification.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.ts";
import { schema } from "../src/db/index.ts";
import { STEP_UP_TTL_MS } from "../src/auth.ts";
import { addMerchant, freshDb } from "./helpers.ts";

const facilitator = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.1" } }], extensions: [], signers: {} }),
} as unknown as FacilitatorClient;

function build() {
  const db = freshDb();
  const app = createApp({ db, facilitator, quiet: true, callMerchant: async () => { throw new Error("unused"); }, gatewayPaidMerchant: async () => null, chainCheckDelayMs: 0 });
  return { db, app };
}

type App = ReturnType<typeof build>["app"];

/** Tiny cookie-jar client. */
async function login(app: App, name = "alice") {
  const res = await app.request("/api/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const call = (path: string, init: RequestInit = {}) => app.request(path, {
    ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { cookie, call, body: await res.json() };
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

const AGENT_PASS_ENV = { WORLD_OIDC_CLIENT_ID: "c", WORLD_OIDC_CLIENT_SECRET: "s", WORLD_OIDC_REDIRECT_URI: "https://x/cb" };
function withAgentPass() { Object.assign(process.env, AGENT_PASS_ENV); }
afterEach(() => { for (const k of Object.keys(AGENT_PASS_ENV)) delete process.env[k]; });

describe("accounts and sessions", () => {
  it("first login creates an account with no roles and sends it to onboarding", async () => {
    const { app } = build();
    const { call, body } = await login(app);
    expect(body).toMatchObject({ roles: { owner: false, merchant: false }, identity: "dev", next: "/onboarding" });
    expect((await call("/api/me")).status).toBe(200);
  });

  it("logging in again returns the same account", async () => {
    const { app } = build();
    const a = await login(app, "bob");
    const b = await login(app, "bob");
    expect(a.body.id).toBe(b.body.id);
  });

  it("logout revokes the session on the server, not only the cookie", async () => {
    const { app } = build();
    const { call } = await login(app);
    expect((await call("/api/logout", { method: "POST" })).status).toBe(200);
    expect((await call("/api/me")).status).toBe(401); // replaying the old cookie fails
  });

  it("logout everywhere ends every session of the account", async () => {
    const { app } = build();
    const one = await login(app, "carol");
    const two = await login(app, "carol");
    await one.call("/api/logout?all=1", { method: "POST" });
    expect((await two.call("/api/me")).status).toBe(401);
  });

  it("an expired session is rejected", async () => {
    const { db, app } = build();
    const { call } = await login(app);
    db.update(schema.sessions).set({ expiresAt: Date.now() - 1 }).run();
    expect((await call("/api/me")).status).toBe(401);
  });

  it("a forged cookie is rejected", async () => {
    const { app } = build();
    expect((await app.request("/api/me", { headers: { cookie: "app_session=forged" } })).status).toBe(401);
  });

  it("dev login is disabled once Agent Pass is configured", async () => {
    const { app } = build();
    withAgentPass();
    const res = await app.request("/api/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
    expect(res.status).toBe(403);
  });
});

describe("roles", () => {
  it("owner APIs need the owner role; enabling it is self-service", async () => {
    const { app } = build();
    const { call } = await login(app);
    expect((await call("/api/agents")).status).toBe(403);
    const me = await (await call("/api/me/roles", json({ role: "owner" }))).json();
    expect(me.roles.owner).toBe(true);
    expect((await call("/api/agents")).status).toBe(200);
  });

  it("one account can hold both roles", async () => {
    const { app } = build();
    const { call } = await login(app);
    await call("/api/me/roles", json({ role: "owner" }));
    const me = await (await call("/api/me/roles", json({ role: "merchant" }))).json(); // dev: World not configured
    expect(me.roles).toEqual({ owner: true, merchant: true });
    expect((await call("/api/agents")).status).toBe(200);
    expect((await call("/api/merchants/me")).status).toBe(404); // allowed, just not registered yet
  });

  it("owners only see their own agents", async () => {
    const { app } = build();
    const { call } = await login(app);
    await call("/api/me/roles", json({ role: "owner" }));
    expect(await (await call("/api/agents")).json()).toEqual([]); // the fixture agent belongs to acct_owner
    expect((await call("/api/agents/agt_1")).status).toBe(404);
  });
});

describe("Agent Pass step-up", () => {
  async function ownerOfAgent(db: ReturnType<typeof build>["db"], app: App) {
    const s = await login(app, "owner");
    await s.call("/api/me/roles", json({ role: "owner" }));
    const me = await (await s.call("/api/me")).json();
    db.update(schema.agents).set({ ownerId: me.id }).where(eq(schema.agents.id, "agt_1")).run();
    withAgentPass(); // after login: Agent Pass switches dev login off
    return s;
  }
  const grant = (db: ReturnType<typeof build>["db"], scope: string, at = Date.now()) =>
    db.update(schema.sessions).set({ stepUpScope: scope, stepUpAt: at }).run();

  it("tightening limits never needs a step-up", async () => {
    const { db, app } = build();
    const { call } = await ownerOfAgent(db, app);
    expect((await call("/api/agents/agt_1", { method: "PATCH", body: JSON.stringify({ perCallCap: 400_000 }) })).status).toBe(200);
    expect((await call("/api/agents/agt_1", { method: "PATCH", body: JSON.stringify({ status: "paused" }) })).status).toBe(200);
  });

  it("raising a cap needs a fresh step-up, which is single use", async () => {
    const { db, app } = build();
    const { call } = await ownerOfAgent(db, app);
    const raise = (n: number) => call("/api/agents/agt_1", { method: "PATCH", body: JSON.stringify({ dailyCap: n }) });
    const denied = await raise(6_000_000);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "step_up_required", scope: "agent:agt_1:limits" });

    grant(db, "agent:agt_1:limits");
    expect((await raise(6_000_000)).status).toBe(200);
    expect((await raise(7_000_000)).status).toBe(403); // consumed
  });

  it("a step-up for another scope or an old one does not count", async () => {
    const { db, app } = build();
    const { call } = await ownerOfAgent(db, app);
    const off = () => call("/api/agents/agt_1", { method: "PATCH", body: JSON.stringify({ allowlistOnly: false }) });
    grant(db, "agent:agt_1:key");
    expect((await off()).status).toBe(403);
    grant(db, "agent:agt_1:limits", Date.now() - STEP_UP_TTL_MS - 1000);
    expect((await off()).status).toBe(403);
  });

  it("rotating an API key needs a step-up and invalidates the old key", async () => {
    const { db, app } = build();
    const { call } = await ownerOfAgent(db, app);
    expect((await call("/api/agents/agt_1/rotate-key", { method: "POST" })).status).toBe(403);
    grant(db, "agent:agt_1:key");
    const before = db.select().from(schema.agents).get()!.apiKeyHash;
    const r = await call("/api/agents/agt_1/rotate-key", { method: "POST" });
    expect(r.status).toBe(200);
    expect((await r.json()).apiKey).toMatch(/^apk_/);
    expect(db.select().from(schema.agents).get()!.apiKeyHash).not.toBe(before);
  });

  it("with Agent Pass, a payment cannot be approved by a plain API call", async () => {
    const { db, app } = build();
    const { call } = await ownerOfAgent(db, app);
    const m = addMerchant(db);
    db.insert(schema.approvals).values({ id: "apr_1", agentId: "agt_1", merchantId: m.id, amount: 300_000, expiresAt: Date.now() + 60_000 }).run();
    expect((await call("/api/approvals/apr_1/approve", { method: "POST" })).status).toBe(403);
    expect(db.select().from(schema.approvals).get()!.status).toBe("pending");
    expect((await call("/api/approvals/apr_1/reject", { method: "POST" })).status).toBe(200); // refusing is always allowed
  });

  it("only safe relative paths are accepted as a return destination", async () => {
    const { safeNext } = await import("../src/chain/agentpass.ts");
    expect(safeNext("/owner/agents/x")).toBe("/owner/agents/x");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "", undefined]) expect(safeNext(bad)).toBe("");
  });
});
