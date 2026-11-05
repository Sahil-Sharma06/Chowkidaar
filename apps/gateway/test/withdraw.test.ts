/** Bond withdrawal: only the unreserved part, behind a World ID step-up, and never twice. */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.ts";
import { schema } from "../src/db/index.ts";
import type { BondWithdraw } from "../src/routes/merchants.ts";
import { addMerchant, freshDb } from "./helpers.ts";

const facilitator = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.1" } }], extensions: [], signers: {} }),
} as unknown as FacilitatorClient;

const AGENT_PASS_ENV = { WORLD_OIDC_CLIENT_ID: "c", WORLD_OIDC_CLIENT_SECRET: "s", WORLD_OIDC_REDIRECT_URI: "https://x/cb" };
afterEach(() => { for (const k of Object.keys(AGENT_PASS_ENV)) delete process.env[k]; });

/** A signed-in merchant who owns `good-data` (price 0.10, bond 2.00, so the minimum bond is 1.20). */
async function setup(transfer: BondWithdraw = async () => ({ txId: "0.0.1002@1.000000001" })) {
  const db = freshDb();
  const calls: Parameters<BondWithdraw>[0][] = [];
  const app = createApp({
    db, facilitator, quiet: true, chainCheckDelayMs: 0,
    callMerchant: async () => { throw new Error("unused"); }, gatewayPaidMerchant: async () => null,
    bondWithdraw: async (o) => { calls.push(o); return transfer(o); },
  });
  const login = await app.request("/api/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "merchant" }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const call = (path: string, body?: unknown) => app.request(path, {
    method: body === undefined ? "GET" : "POST", headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const me = await (await call("/api/me/roles", { role: "merchant" })).json();
  const m = addMerchant(db);
  db.update(schema.merchants).set({ accountId: me.id }).where(eq(schema.merchants.id, m.id)).run();
  const merchant = () => db.select().from(schema.merchants).where(eq(schema.merchants.id, m.id)).get()!;
  const withdraw = (amount: number) => call(`/api/merchants/${m.id}/bond/withdraw`, { amount });
  return { db, call, calls, merchant, withdraw, id: m.id };
}

describe("bond withdrawal", () => {
  it("pays the payout account, lowers the bond and records the transaction", async () => {
    const { calls, merchant, withdraw, db } = await setup();
    const res = await withdraw(500_000);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ withdrawn: "500000", txId: "0.0.1002@1.000000001", balance: "1500000" });
    expect(calls).toEqual([{ merchantId: merchant().id, to: "0.0.8888888", amount: 500_000 }]);
    expect(merchant()).toMatchObject({ bondBalance: 1_500_000, status: "live" });
    expect(db.select().from(schema.bondLedger).all()).toMatchObject([{ type: "withdraw", amount: 500_000, txId: "0.0.1002@1.000000001" }]);
  });

  it("a live merchant that drops below the minimum bond stops taking calls", async () => {
    const { merchant, withdraw } = await setup();
    expect((await withdraw(1_000_000)).status).toBe(200); // 2.00 -> 1.00, minimum is 1.20
    expect(merchant().status).toBe("needs_bond");
  });

  it("cannot withdraw money reserved for calls in progress", async () => {
    const { db, merchant, withdraw, calls } = await setup();
    db.update(schema.merchants).set({ bondLocked: 1_800_000 }).run(); // only 0.20 is free
    const res = await withdraw(300_000);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "insufficient_available", available: "200000" });
    expect(calls).toHaveLength(0);
    expect(merchant().bondBalance).toBe(2_000_000);
  });

  it("a failed transfer gives the money back to the bond", async () => {
    const { db, merchant, withdraw } = await setup(async () => { throw new Error("INSUFFICIENT_TOKEN_BALANCE"); });
    expect((await withdraw(500_000)).status).toBe(502);
    expect(merchant()).toMatchObject({ bondBalance: 2_000_000, status: "live" });
    expect(db.select().from(schema.bondLedger).all()).toHaveLength(0);
  });

  it("with World ID configured it needs a fresh, single-use step-up", async () => {
    const { db, withdraw, calls, id } = await setup();
    Object.assign(process.env, AGENT_PASS_ENV);
    const denied = await withdraw(100_000);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "step_up_required", scope: `merchant:${id}:withdraw` });
    db.update(schema.sessions).set({ stepUpScope: `merchant:${id}:withdraw`, stepUpAt: Date.now() }).run();
    expect((await withdraw(100_000)).status).toBe(200);
    expect((await withdraw(100_000)).status).toBe(403); // the step-up was spent
    expect(calls).toHaveLength(1);
  });

  it("a suspended merchant cannot withdraw", async () => {
    const { db, withdraw, calls } = await setup();
    db.update(schema.merchants).set({ status: "suspended" }).run();
    expect((await withdraw(100_000)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("only the merchant's own bond can be withdrawn", async () => {
    const { db, call } = await setup();
    const other = addMerchant(db, { slug: "someone-else" });
    expect((await call(`/api/merchants/${other.id}/bond/withdraw`, { amount: 1 })).status).toBe(404);
  });
});
