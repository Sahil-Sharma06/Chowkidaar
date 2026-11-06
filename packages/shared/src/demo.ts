import type { DemoRunResult, DemoStep } from "./types.ts";
import { formatUsdc, hashscanTx } from "./money.ts";

/** The steps of one protected call, as shown on the sandbox and playground timelines. */
export const PIPELINE_STEPS = (): DemoStep[] => [
  { key: "policy", label: "Checked spending limits", state: "running" },
  { key: "agent_pay", label: "Agent paid the gateway", state: "pending" },
  { key: "merchant_pay", label: "Gateway paid the merchant and called it", state: "pending" },
  { key: "checks", label: "Response checked", state: "pending" },
  { key: "outcome", label: "Outcome", state: "pending" },
  { key: "hcs", label: "Receipt written to HCS", state: "pending" },
];

export interface GatewayReply {
  status: number;
  body: Record<string, unknown> | null;
  agentTx: string | null;
  price: string | number;
  total: string | number;
  hashscan?: string;
}

/** Fills the step list in place from the gateway's reply to one /v1/call and returns the run outcome. */
export function applyGatewayReply(steps: DemoStep[], r: GatewayReply): Pick<DemoRunResult, "outcome" | "paymentId" | "error"> {
  const set = (key: string, patch: Partial<DemoStep>) => Object.assign(steps.find((s) => s.key === key)!, patch);
  const skipRest = () => { for (const k of ["agent_pay", "merchant_pay", "checks", "outcome", "hcs"]) set(k, { state: "skipped" }); };
  const body = r.body;

  if (r.status === 202) {
    set("policy", { state: "failed", detail: `Held: owner approval required (approval ${String(body?.approvalId)}). Approve it in the owner dashboard, then run again.` });
    skipRest();
    return { outcome: "blocked", paymentId: null };
  }
  if (r.status === 401 || r.status === 403) {
    set("policy", { state: "failed", detail: `Blocked before payment: ${String(body?.error)}` });
    skipRest();
    return { outcome: "blocked", paymentId: null };
  }
  set("policy", { state: "done", detail: `Allowed: ${formatUsdc(r.total)} (price ${formatUsdc(r.price)} + fee)` });
  set("agent_pay", r.agentTx
    ? { state: "done", detail: `Paid ${formatUsdc(r.total)} to the gateway`, link: hashscanTx(r.agentTx, r.hashscan) }
    : { state: r.status === 200 || r.status === 502 ? "done" : "failed", detail: "Settled (tx id on receipt)" });

  const paymentId = (body?.paymentId as string) ?? null;
  let outcome: DemoRunResult["outcome"] = "error";
  let error: string | undefined;
  if (r.status === 200) {
    set("merchant_pay", { state: "done", detail: `Gateway paid ${formatUsdc(r.price)}` });
    set("checks", { state: "done", detail: "Status, body, format and schema all passed" });
    set("outcome", { state: "done", detail: "Delivered" });
    outcome = "delivered";
  } else if (r.status === 502) {
    const fc = body?.faultCase as string | undefined;
    set("merchant_pay", fc === "B" ? { state: "done", detail: "Merchant failed before settling: it was never paid" } : fc === "C" ? { state: "failed", detail: "Gateway error (our fault)" } : { state: "done", detail: `Gateway paid ${formatUsdc(r.price)}` });
    set("checks", { state: "failed", detail: `Failed: ${String(body?.reason)}${body?.detail ? ` (${String(body.detail)})` : ""}` });
    set("outcome", { state: "running", detail: `Refund of ${formatUsdc(String(body?.refundAmount ?? "0"))} in progress${fc === "A" ? ", merchant bond will be slashed" : ""}` });
    outcome = "refund_pending";
  } else {
    set("merchant_pay", { state: "failed", detail: `Gateway returned ${r.status}` });
    error = JSON.stringify(body);
  }
  set("hcs", { state: "pending", detail: "Pending (worker)" });
  return { outcome, paymentId, error };
}
