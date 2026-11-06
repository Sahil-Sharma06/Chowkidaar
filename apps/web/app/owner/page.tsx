"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@app/shared";
import { get, type AgentRow, type ApprovalRow } from "@/lib/api";
import { Badge, Empty, Money, Stat, StatusBadge, fmtTime } from "@/lib/ui";

export default function OwnerDashboard() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents") });
  const payments = useQuery({ queryKey: ["owner-payments"], queryFn: () => get<Receipt[]>("/api/owner/payments"), refetchInterval: 4000 });
  const approvals = useQuery({ queryKey: ["approvals", "pending"], queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"), refetchInterval: 3000 });

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = Date.now() - 7 * 86_400_000;
  const todays = payments.data?.filter((p) => p.createdAt >= todayStart.getTime()) ?? [];
  const spentToday = todays.reduce((s, p) => s + Number(p.money.agentPaid) - Number(p.money.refunded), 0);
  const refundedToday = todays.reduce((s, p) => s + Number(p.money.refunded), 0);
  const refundsWeek = payments.data?.filter((p) => p.createdAt >= weekStart && p.status === "refunded").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Owner dashboard</h1>
        <div className="flex gap-2"><Link href="/console" className="btn-secondary">Open console</Link><Link href="/playground" className="btn-secondary">Playground</Link><Link href="/owner/agents/new" className="btn-primary">Create agent</Link></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Spent today" value={<Money micro={spentToday} />} />
        <Stat label="Refunded today" value={<Money micro={refundedToday} />} />
        <Stat label="Refunds this week" value={refundsWeek} />
        <Stat label="Pending approvals" value={approvals.data?.length ?? 0} hint={<Link className="text-blue-700 hover:underline" href="/owner/approvals">Review</Link>} />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Agents</h2>
        {agents.data?.length === 0 ? <Empty title="No agents yet" action={<Link href="/owner/agents/new" className="btn-primary">Create your first agent</Link>} /> : (
          <div className="card overflow-x-auto p-0"><table className="table">
            <thead><tr><th>Name</th><th>Account</th><th>Status</th><th>Daily use</th><th>Last payment</th></tr></thead>
            <tbody>{agents.data?.map((a) => (
              <tr key={a.id}>
                <td><Link className="font-medium text-blue-700 hover:underline" href={`/owner/agents/${a.id}`}>{a.name}</Link></td>
                <td className="text-xs">{a.hederaAccountId}</td>
                <td><Badge tone={a.status === "active" ? "green" : "grey"}>{a.status}</Badge></td>
                <td><Money micro={a.spentToday} /> <span className="text-xs text-slate-500">of <Money micro={a.dailyCap} /></span></td>
                <td className="text-xs">{fmtTime(a.lastPaymentAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Recent payments</h2>
        <div className="card overflow-x-auto p-0"><table className="table">
          <thead><tr><th>Time</th><th>Agent</th><th>Merchant</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead>
          <tbody>
            {payments.data?.map((p) => (
              <tr key={p.paymentId}>
                <td className="text-xs">{fmtTime(p.createdAt)}</td><td>{p.agentName}</td><td>{p.merchant.name}</td>
                <td><Money micro={p.money.agentPaid} /></td><td><StatusBadge status={p.status} /></td>
                <td><Link className="text-blue-700 hover:underline" href={`/receipts/${p.paymentId}`}>View</Link></td>
              </tr>
            ))}
            {payments.data?.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No payments yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
