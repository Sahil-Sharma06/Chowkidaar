"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicMerchant, Receipt } from "@app/shared";
import { get, patch, put, type AgentRow } from "@/lib/api";
import { Alert, Badge, Field, Money, StatusBadge, fmtTime, microFromInput, usdcInput } from "@/lib/ui";

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const agent = useQuery({ queryKey: ["agent", id], queryFn: () => get<AgentRow>(`/api/agents/${id}`) });
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants") });
  const payments = useQuery({ queryKey: ["agent-payments", id], queryFn: () => get<Receipt[]>(`/api/agents/${id}/payments`), refetchInterval: 4000 });
  const [filter, setFilter] = useState<"all" | "delivered" | "refunded">("all");
  const [f, setF] = useState({ perCallCap: "", dailyCap: "", approvalThreshold: "", minScore: "" });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (agent.data) setF({ perCallCap: usdcInput(agent.data.perCallCap), dailyCap: usdcInput(agent.data.dailyCap), approvalThreshold: usdcInput(agent.data.approvalThreshold), minScore: String(agent.data.minScore) }); }, [agent.data]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["agent", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); };
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => patch(`/api/agents/${id}`, body), onSuccess: () => { invalidate(); setMsg("Saved"); setTimeout(() => setMsg(null), 1500); }, onError: (e) => setMsg(String(e)) });
  const allow = useMutation({ mutationFn: (merchantIds: string[]) => put(`/api/agents/${id}/allowlist`, { merchantIds }), onSuccess: invalidate });

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
