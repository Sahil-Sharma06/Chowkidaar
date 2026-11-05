"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { PublicMerchant, Receipt } from "@app/shared";
import { ApiError, get, isStepUp, patch, post, put, startStepUp, takePendingStepUp, type AgentRow } from "@/lib/api";
import { Alert, Badge, Field, Money, StatusBadge, fmtTime, microFromInput, usdcInput } from "@/lib/ui";
import { reasonText } from "@/lib/world";

const ERRORS: Record<string, string> = {
  daily_cap_below_per_call: "The daily cap must be at least the per-call cap.",
  approval_above_per_call: "The approval amount must be at most the per-call cap.",
  validation_error: "Check the values: amounts must be positive numbers.",
};
const errorText = (code: string) => ERRORS[code] ?? "Could not save. Please try again.";

export default function AgentDetailPage() {
  return <Suspense><AgentDetail /></Suspense>;
}

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const agent = useQuery({ queryKey: ["agent", id], queryFn: () => get<AgentRow>(`/api/agents/${id}`) });
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants") });
  const payments = useQuery({ queryKey: ["agent-payments", id], queryFn: () => get<Receipt[]>(`/api/agents/${id}/payments`), refetchInterval: 4000 });
  const [filter, setFilter] = useState<"all" | "delivered" | "refunded">("all");
  const [f, setF] = useState({ perCallCap: "", dailyCap: "", approvalThreshold: "", minScore: "" });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (agent.data) setF({ perCallCap: usdcInput(agent.data.perCallCap), dailyCap: usdcInput(agent.data.dailyCap), approvalThreshold: usdcInput(agent.data.approvalThreshold), minScore: String(agent.data.minScore) }); }, [agent.data]);

  const params = useSearchParams();
  const [newKey, setNewKey] = useState<string | null>(null);
  const here = `/owner/agents/${id}`;

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["agent", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); };
  // Loosening a limit answers step_up_required: verify with World ID, come back, and finish the save.
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/api/agents/${id}`, body),
    onSuccess: () => { invalidate(); setMsg("Saved"); setTimeout(() => setMsg(null), 2000); },
    onError: (e, body) => isStepUp(e) ? startStepUp(e.body.scope, here, { kind: "limits", body }) : setMsg(e instanceof ApiError ? errorText(e.code) : "Could not save. Please try again."),
  });
  const rotate = useMutation({
    mutationFn: () => post<AgentRow>(`/api/agents/${id}/rotate-key`),
    onSuccess: (a) => { setNewKey(a.apiKey ?? null); invalidate(); },
    onError: (e) => isStepUp(e) ? startStepUp(e.body.scope, here, { kind: "key" }) : setMsg("Could not rotate the key. Please try again."),
  });
  const allow = useMutation({ mutationFn: (merchantIds: string[]) => put(`/api/agents/${id}/allowlist`, { merchantIds }), onSuccess: invalidate });

  // Back from a step-up: finish what the owner asked for (once), or explain why it did not happen.
  const stepup = params.get("stepup");
  const scope = params.get("scope") ?? "";
  useEffect(() => {
    if (stepup !== "ok") return;
    window.history.replaceState(null, "", here);
    if (scope === `agent:${id}:limits`) { const p = takePendingStepUp<{ body: Record<string, unknown> }>(scope); if (p) update.mutate(p.body); }
    if (scope === `agent:${id}:key`) { if (takePendingStepUp(scope)) rotate.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepup, scope]);

  if (!agent.data) return <div className="text-sm text-slate-500">Loading…</div>;
  const a = agent.data;
  const allowed = new Set(a.allowedMerchantIds);
  const rows = payments.data?.filter((p) => filter === "all" || (filter === "delivered" ? p.status === "delivered" : p.status.startsWith("refund"))) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">{a.name}</h1><div className="text-xs text-slate-500">{a.hederaAccountId}</div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.status === "paused"} onChange={(e) => update.mutate({ status: e.target.checked ? "paused" : "active" })} /> Paused (blocks all new payments)</label>
      </div>

      {stepup === "denied" && <Alert tone="red">{reasonText(params.get("reason"))} Your change was not saved.</Alert>}
      <Alert tone="blue"><ShieldCheck className="mr-1 inline h-4 w-4" />Lowering limits or pausing takes effect at once. Raising a limit, lowering the minimum score, turning off the allowlist, or replacing the API key asks you to verify with World ID first.</Alert>

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">API key</h2>
          <p className="text-sm text-slate-600">Your agent sends this key as <code>x-agent-key</code>. Replace it if it may have leaked: the old key stops working at once.</p>
        </div>
        <button className="btn-secondary" disabled={rotate.isPending} onClick={() => { if (confirm("Replace this agent's API key? The current key stops working immediately.")) rotate.mutate(); }}>
          <KeyRound className="h-4 w-4" /> Replace key
        </button>
        {newKey && (
          <div className="w-full space-y-1">
            <Alert tone="amber">Copy this key now. It is shown only once.</Alert>
            <code className="block break-all rounded bg-slate-100 p-2 text-sm">{newKey}</code>
          </div>
        )}
      </section>

      <form className="card grid gap-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); try { update.mutate({ perCallCap: microFromInput(f.perCallCap), dailyCap: microFromInput(f.dailyCap), approvalThreshold: microFromInput(f.approvalThreshold), minScore: Number(f.minScore) }); } catch (err) { setMsg(String((err as Error).message)); } }}>
        <Field label="Per-call cap (USDC)"><input className="input" value={f.perCallCap} onChange={(e) => setF({ ...f, perCallCap: e.target.value })} /></Field>
        <Field label="Daily cap (USDC)"><input className="input" value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: e.target.value })} /></Field>
        <Field label="Approval above (USDC)"><input className="input" value={f.approvalThreshold} onChange={(e) => setF({ ...f, approvalThreshold: e.target.value })} /></Field>
        <Field label="Min merchant score"><input className="input" type="number" min={0} max={100} value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} /></Field>
        <div className="flex items-center gap-3 sm:col-span-4"><button className="btn-primary" disabled={update.isPending}>Save limits</button>{msg && <span className="text-sm text-slate-600">{msg}</span>}</div>
      </form>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Allowed merchants</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.allowlistOnly} onChange={(e) => update.mutate({ allowlistOnly: e.target.checked })} /> Allowlist only</label>
        </div>
        {!a.allowlistOnly && <Alert tone="amber">Allowlist is off: this agent may pay any live, covered merchant.</Alert>}
        <table className="table">
          <thead><tr><th>Allow</th><th>Merchant</th><th>Price</th><th>Score</th><th>Coverage</th></tr></thead>
          <tbody>{merchants.data?.map((m) => (
            <tr key={m.id}>
              <td><input type="checkbox" checked={allowed.has(m.id)} onChange={(e) => { const next = new Set(allowed); e.target.checked ? next.add(m.id) : next.delete(m.id); allow.mutate([...next]); }} /></td>
              <td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.slug}</div></td>
              <td><Money micro={m.price} /></td>
              <td>{m.score ?? <Badge tone="blue">New</Badge>}</td>
              <td>{m.covered ? <Badge tone="green">Covered</Badge> : <Badge tone="amber">Not covered</Badge>}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Payment history</h2>
          {(["all", "delivered", "refunded"] as const).map((k) => <button key={k} onClick={() => setFilter(k)} className={`btn-ghost px-2 py-1 text-xs ${filter === k ? "bg-slate-200" : ""}`}>{k}</button>)}
        </div>
        <div className="card overflow-x-auto p-0"><table className="table">
          <thead><tr><th>Time</th><th>Merchant</th><th>Paid</th><th>Refunded</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((p) => <tr key={p.paymentId}><td className="text-xs">{fmtTime(p.createdAt)}</td><td>{p.merchant.name}</td><td><Money micro={p.money.agentPaid} /></td><td><Money micro={p.money.refunded} /></td><td><StatusBadge status={p.status} /></td><td><Link className="text-blue-700 hover:underline" href={`/receipts/${p.paymentId}`}>Receipt</Link></td></tr>)}
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Nothing here yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
