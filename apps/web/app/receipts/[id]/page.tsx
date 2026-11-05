"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@app/shared";
import { get } from "@/lib/api";
import { Alert, Badge, Money, StatusBadge, TxLink, fmtTime, reasonLabel } from "@/lib/ui";

const FINAL = new Set(["delivered", "refunded", "refund_failed"]);

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => get<Receipt>(`/api/public/receipts/${id}`),
    refetchInterval: (query) => { const d = query.state.data; return d && FINAL.has(d.status) && (d.hcs.sequence || !d.hcs.topicId) ? false : 1500; },
  });
  if (q.isLoading) return <div className="text-sm text-slate-500">Loading receipt…</div>;
  if (!q.data) return <Alert tone="red">Receipt not found.</Alert>;
  const r = q.data;
  const banner = r.status === "delivered" ? "green" : r.status === "refund_failed" ? "red" : r.status === "calling" ? "blue" : "amber";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className={`rounded-xl p-5 ring-1 ring-inset ${banner === "green" ? "bg-emerald-50 ring-emerald-200" : banner === "amber" ? "bg-amber-50 ring-amber-200" : banner === "red" ? "bg-rose-50 ring-rose-200" : "bg-blue-50 ring-blue-200"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-600">Receipt {r.paymentId}</div>
            <div className="mt-1 text-2xl font-semibold">{r.status === "delivered" ? "Delivered" : r.status === "refunded" ? "Refunded" : r.status === "refund_pending" ? "Refund in progress" : r.status === "refund_failed" ? "Refund failed" : "In progress"}</div>
            {r.reason && <div className="text-sm text-slate-700">{reasonLabel(r.reason)}{r.detail ? ` — ${r.detail}` : ""}</div>}
          </div>
          <StatusBadge status={r.status} />
        </div>
        <div className="mt-3 text-xs text-slate-600">{r.merchant.name} ({r.merchant.slug}) · agent {r.agentAccount} · {fmtTime(r.createdAt)}</div>
      </div>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Money</h2>
        <table className="table">
          <tbody>
            <tr><td>Agent paid</td><td className="text-right"><Money micro={r.money.agentPaid} /></td></tr>
            <tr><td>Merchant received</td><td className="text-right"><Money micro={r.money.merchantReceived} /></td></tr>
            <tr><td>Refunded to agent</td><td className="text-right"><Money micro={r.money.refunded} /></td></tr>
            <tr><td>Protection fee kept</td><td className="text-right"><Money micro={r.money.feeKept} /></td></tr>
            <tr><td>Bond slashed</td><td className="text-right"><Money micro={r.money.bondSlashed} /></td></tr>
          </tbody>
        </table>
        {r.faultCase && <div className="mt-2 text-xs text-slate-500">Case {r.faultCase}: {r.faultCase === "A" ? "merchant failed after being paid, refund from its bond" : r.faultCase === "B" ? "merchant failed before settling, refund from the gateway, no slash" : "gateway error, full refund including fee"}</div>}
      </section>

      <section className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Proof on Hedera</h2>
        <table className="table">
          <tbody>
            <tr><td>Agent payment</td><td className="text-right"><TxLink id={r.tx.agent} /></td></tr>
            <tr><td>Merchant payment</td><td className="text-right"><TxLink id={r.tx.merchant} /></td></tr>
            <tr><td>Refund</td><td className="text-right"><TxLink id={r.tx.refund} /></td></tr>
            <tr><td>HCS receipt</td><td className="text-right">{r.hcs.sequence ? <TxLink href={r.links.hcs} label={`Topic ${r.hcs.topicId} #${r.hcs.sequence}`} /> : r.hcs.topicId ? <Badge tone="blue">pending</Badge> : <span className="text-slate-400">off</span>}</td></tr>
            <tr><td>Arkiv reputation</td><td className="text-right"><TxLink href={r.links.arkiv} label="Entity" /></td></tr>
          </tbody>
        </table>
      </section>

      <section className="card text-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Evidence</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <div><div className="text-xs text-slate-500">HTTP status</div><div>{r.httpStatus ?? "—"}</div></div>
          <div><div className="text-xs text-slate-500">Latency</div><div>{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</div></div>
          <div><div className="text-xs text-slate-500">Finished</div><div>{fmtTime(r.finishedAt)}</div></div>
        </div>
        <div className="mt-3"><div className="text-xs text-slate-500">Response hash (SHA-256)</div><code className="break-all text-xs">{r.responseHash ?? "—"}</code></div>
        <p className="mt-3 text-xs text-slate-500">A fingerprint of the response. The response itself isn&apos;t stored on-chain. This receipt is recorded by the gateway.</p>
      </section>
    </div>
  );
}
