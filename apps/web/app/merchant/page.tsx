"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MERCHANT_STATUS_TEXT, type Receipt } from "@app/shared";
import { ApiError, get, type MerchantMe } from "@/lib/api";
import { Alert, Badge, Empty, Money, Stat, fmtTime, reasonLabel } from "@/lib/ui";

export default function MerchantDashboard() {
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  const payments = useQuery({ queryKey: ["merchant-payments", me.data?.id], queryFn: () => get<Receipt[]>(`/api/merchants/${me.data!.id}/payments`), enabled: Boolean(me.data?.id), refetchInterval: 4000 });

  if (me.isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (me.error instanceof ApiError && me.error.status === 404) return <Empty title="You haven't registered a service yet." action={<Link href="/merchant/setup" className="btn-primary">Set up your service</Link>} />;
  if (!me.data) return <Alert tone="red">Could not load your merchant.</Alert>;
  const m = me.data;
  const earned = payments.data?.reduce((s, p) => s + Number(p.money.merchantReceived), 0) ?? 0;
  const slashed = payments.data?.reduce((s, p) => s + Number(p.money.bondSlashed), 0) ?? 0;
  const failures = payments.data?.filter((p) => p.status !== "delivered" && p.status !== "calling") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">{m.name}</h1><div className="text-xs text-slate-500">{m.slug} · {m.endpointUrl}</div></div>
        <div className="flex gap-2"><Link href="/merchant/setup" className="btn-secondary">Edit setup</Link><Link href="/merchant/bond" className="btn-primary">Bond</Link></div>
      </div>
      <Alert tone={m.status === "live" ? "green" : m.status === "suspended" ? "red" : "amber"}><strong className="capitalize">{m.status.replace("_", " ")}</strong>: {MERCHANT_STATUS_TEXT[m.status]}</Alert>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Score" value={m.score ?? "New"} />
        <Stat label="Calls" value={m.totalCalls} />
        <Stat label="Failures" value={m.failedCalls} />
        <Stat label="Earned" value={<Money micro={earned} />} />
        <Stat label="Slashed" value={<Money micro={slashed} />} />
        <Stat label="Bond available" value={<Money micro={m.bond.available} />} hint={m.bond.covered ? `${m.bond.failuresCovered} failures covered` : "Not covered"} />
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">Failures</h2>
        <div className="card overflow-x-auto p-0"><table className="table">
          <thead><tr><th>Time</th><th>Reason</th><th>HTTP</th><th>Latency</th><th>Slashed</th><th>Evidence</th><th></th></tr></thead>
          <tbody>
            {failures.map((p) => (
              <tr key={p.paymentId}>
                <td className="text-xs">{fmtTime(p.createdAt)}</td>
                <td>{reasonLabel(p.reason)}{p.detail && <div className="text-xs text-slate-500">{p.detail}</div>}</td>
                <td>{p.httpStatus ?? "—"}</td><td>{p.latencyMs != null ? `${p.latencyMs} ms` : "—"}</td>
                <td><Money micro={p.money.bondSlashed} /></td>
                <td><code className="text-xs">{p.responseHash?.slice(0, 16) ?? "—"}…</code></td>
                <td><Link className="text-blue-700 hover:underline" href={`/receipts/${p.paymentId}`}>Receipt</Link></td>
              </tr>
            ))}
            {failures.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No failures. <Badge tone="green">Nice</Badge></td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-slate-500">A failed check is final in this version. Disputes are out of scope.</p>
      </section>
    </div>
  );
}
