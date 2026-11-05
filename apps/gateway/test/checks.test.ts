import { describe, expect, it } from "vitest";
import { compileSchema, runChecks, type CallResult } from "../src/checks.ts";

const merchant = {
  id: "m1",
  responseSchema: { type: "object", required: ["symbol", "price"], properties: { symbol: { type: "string" }, price: { type: "number" } } },
};

const resp = (status: number, text: string): CallResult =>
  ({ kind: "response", status, text, latencyMs: 10, merchantPaid: true, merchantTxId: "0.0.1@1.2" });

describe("checks", () => {
  it("200 with matching JSON is delivered", () => {
    expect(runChecks(resp(200, JSON.stringify({ symbol: "HBAR", price: 0.1 })), merchant)).toEqual({ ok: true });
  });
  it("500 is http_error", () => {
    expect(runChecks(resp(500, '{"error":"boom"}'), merchant)).toMatchObject({ ok: false, reason: "http_error" });
  });
  it("empty 200 is empty_body", () => {
    expect(runChecks(resp(200, "   "), merchant)).toMatchObject({ ok: false, reason: "empty_body" });
  });
  it("HTML is bad_format", () => {
    expect(runChecks(resp(200, "<html>hi</html>"), merchant)).toMatchObject({ ok: false, reason: "bad_format" });
  });
  it("JSON missing required field is bad_format", () => {
    expect(runChecks(resp(200, '{"symbol":"HBAR"}'), merchant)).toMatchObject({ ok: false, reason: "bad_format" });
  });
  it("valid JSON with a nonsense value passes (known limit)", () => {
    expect(runChecks(resp(200, JSON.stringify({ symbol: "HBAR", price: 999_999_999 })), merchant)).toEqual({ ok: true });
  });
  it("error results pass their reason through", () => {
    const r: CallResult = { kind: "error", reason: "timeout", detail: "x", latencyMs: 5000, merchantPaid: null, merchantTxId: null };
    expect(runChecks(r, merchant)).toMatchObject({ ok: false, reason: "timeout" });
  });
  it("rejects schemas that would accept an empty object", () => {
    expect(() => compileSchema("x", { type: "object" })).toThrow();
    expect(() => compileSchema("y", { type: "array", required: ["a"] })).toThrow();
    expect(() => compileSchema("z", { type: "object", required: [] })).toThrow();
  });
});
