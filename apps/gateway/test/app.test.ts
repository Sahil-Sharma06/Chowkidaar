/**
 * Integration test with a mock facilitator. The agent leg is "settled" by the mock; the
 * merchant leg is replaced by an injected callMerchant so each case is deterministic.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.ts";
import { schema } from "../src/db/index.ts";
import type { CallResult } from "../src/checks.ts";
import { API_KEY, AGENT_ACCOUNT, addMerchant, freshDb } from "./helpers.ts";

let settleN = 0;
const mockFacilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.9185802" } }],
    extensions: [], signers: {},
  }),
  verify: async () => ({ isValid: true, payer: AGENT_ACCOUNT }),
  settle: async (_payload: unknown, req: { amount: string }) => ({
    success: true, transaction: `0.0.9185802@1793898188.${String(++settleN).padStart(9, "0")}`,
    network: "hedera:testnet", payer: AGENT_ACCOUNT, amount: req.amount,
  }),
} as unknown as FacilitatorClient;

// Minimal client-side payload: the mock facilitator does not inspect it.
const paymentHeader = (accepts: Record<string, unknown>) => Buffer.from(JSON.stringify({
  x402Version: 2, resource: { url: "http://gw/v1/call/x" }, accepted: accepts, payload: { transaction: "AAAA" },
})).toString("base64");

function build(result: CallResult, paidOnChain: string | null = null) {
  const db = freshDb();
  const app = createApp({
    db, facilitator: mockFacilitator, quiet: true,
    callMerchant: async () => result,
    gatewayPaidMerchant: async () => paidOnChain,
    chainCheckDelayMs: 0,
  });
  return { db, app };
}

async function paidCall(app: ReturnType<typeof createApp>, slug = "good-data", extraHeaders: Record<string, string> = {}) {
  const first = await app.request(`/v1/call/${slug}`, { method: "POST", headers: { "x-agent-key": API_KEY, "content-type": "application/json", ...extraHeaders }, body: "{}" });
  if (first.status !== 402) return first;
  const req = JSON.parse(Buffer.from(first.headers.get("payment-required")!, "base64").toString()) as { accepts: Record<string, unknown>[] };
  return app.request(`/v1/call/${slug}`, {
    method: "POST", body: "{}",
    headers: { "x-agent-key": API_KEY, "content-type": "application/json", "payment-signature": paymentHeader(req.accepts[0]!), ...extraHeaders },
  });
}

const ok: CallResult = { kind: "response", status: 200, text: JSON.stringify({ symbol: "HBAR", price: 0.1 }), latencyMs: 20, merchantPaid: true, merchantTxId: "0.0.1@1.1" };

describe("gateway app", () => {
  it("returns 402 with price + fee before payment", async () => {
    const { db, app } = build(ok); addMerchant(db);
    const res = await app.request("/v1/call/good-data", { method: "POST", headers: { "x-agent-key": API_KEY } });
    expect(res.status).toBe(402);
    const req = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString());
    expect(req.accepts[0].amount).toBe("102000");
    expect(req.accepts[0].payTo).toBe("0.0.1001");
    expect(req.accepts[0].extra.paymentFlow).toBe("upfront");
    expect(db.select().from(schema.payments).all()).toHaveLength(0);
  });

  it("policy blocks before any payment", async () => {
    const { db, app } = build(ok); addMerchant(db, { price: 600_000, bondBalance: 10_000_000 });
    const res = await app.request("/v1/call/good-data", { method: "POST", headers: { "x-agent-key": API_KEY } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "per_call_cap_exceeded" });
    expect(db.select().from(schema.payments).all()).toHaveLength(0);
  });

  it("delivered: returns data, unlocks bond, queues HCS", async () => {
    const { db, app } = build(ok); addMerchant(db);
    const res = await paidCall(app);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("delivered");
    expect(body.data.symbol).toBe("HBAR");
    const p = db.select().from(schema.payments).get()!;
    expect(p.status).toBe("delivered");
    const m = db.select().from(schema.merchants).get()!;
    expect(m.bondLocked).toBe(0);
    expect(m.totalCalls).toBe(1);
    expect(db.select().from(schema.jobs).all().map((j) => j.kind)).toEqual(["hcs"]);
  });

  it("case A: merchant paid then returned 500 -> refund_pending, lock kept, refund queued", async () => {
    const bad: CallResult = { ...ok, status: 500, text: '{"error":"boom"}' };
    const { db, app } = build(bad); addMerchant(db);
    const res = await paidCall(app);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ outcome: "refund_pending", reason: "http_error", faultCase: "A", refundAmount: "100000" });
    const p = db.select().from(schema.payments).get()!;
    expect(p.faultCase).toBe("A");
    expect(db.select().from(schema.merchants).get()!.bondLocked).toBe(120_000);
    expect(db.select().from(schema.merchants).get()!.failedCalls).toBe(1);
    expect(db.select().from(schema.jobs).all().map((j) => j.kind)).toEqual(["refund"]);
  });

  it("case B: merchant not paid (honest 500) -> refund from gateway, bond unlocked", async () => {
    const honest: CallResult = { ...ok, status: 500, text: '{"error":"boom"}', merchantPaid: false, merchantTxId: null };
    const { db, app } = build(honest); addMerchant(db);
    const res = await paidCall(app);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ faultCase: "B" });
    expect(db.select().from(schema.merchants).get()!.bondLocked).toBe(0);
  });

  it("timeout: chain check decides A vs B", async () => {
    const t: CallResult = { kind: "error", reason: "timeout", detail: "x", latencyMs: 5000, merchantPaid: null, merchantTxId: null };
    const a = build(t, "0.0.1@9.9"); addMerchant(a.db);
    expect(await (await paidCall(a.app)).json()).toMatchObject({ faultCase: "A", reason: "timeout" });
    expect(a.db.select().from(schema.payments).get()!.merchantTxId).toBe("0.0.1@9.9");
    const b = build(t, null); addMerchant(b.db);
    expect(await (await paidCall(b.app)).json()).toMatchObject({ faultCase: "B" });
  });

  it("case C: gateway error refunds price + fee and does not count", async () => {
    const g: CallResult = { kind: "error", reason: "gateway_error", detail: "INSUFFICIENT_ACCOUNT_BALANCE", latencyMs: 1, merchantPaid: false, merchantTxId: null };
    const { db, app } = build(g); addMerchant(db);
    const res = await paidCall(app);
    expect(await res.json()).toMatchObject({ faultCase: "C", refundAmount: "102000" });
    expect(db.select().from(schema.merchants).get()!.totalCalls).toBe(0);
  });

  it("empty body and HTML are caught", async () => {
    const e = build({ ...ok, text: "" }); addMerchant(e.db);
    expect(await (await paidCall(e.app)).json()).toMatchObject({ reason: "empty_body", faultCase: "A" });
    const h = build({ ...ok, text: "<html></html>" }); addMerchant(h.db);
    expect(await (await paidCall(h.app)).json()).toMatchObject({ reason: "bad_format", faultCase: "A" });
  });

  it("approval flow: 202 then approved call passes", async () => {
    const { db, app } = build(ok); addMerchant(db);
    db.update(schema.agents).set({ approvalThreshold: 50_000 }).run();
    const r1 = await app.request("/v1/call/good-data", { method: "POST", headers: { "x-agent-key": API_KEY } });
    expect(r1.status).toBe(202);
    const { approvalId } = await r1.json();
    db.update(schema.approvals).set({ status: "approved" }).where(eq(schema.approvals.id, approvalId)).run();
    const r2 = await paidCall(app, "good-data", { "x-approval-id": approvalId });
    expect(r2.status).toBe(200);
    expect(db.select().from(schema.approvals).get()!.status).toBe("used");
  });

  it("public receipt and stats", async () => {
    const { db, app } = build(ok); addMerchant(db);
    const { paymentId } = await (await paidCall(app)).json();
    const r = await app.request(`/api/public/receipts/${paymentId}`);
    expect(r.status).toBe(200);
    const receipt = await r.json();
    expect(receipt.money.agentPaid).toBe("102000");
    expect(receipt.links.agent).toContain("hashscan.io/testnet/transaction/0.0.9185802-1793898188-");
    const s = await (await app.request("/api/public/stats")).json();
    expect(s.protectedCalls).toBe(1);
  });
});
