"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@app/shared";
import { get } from "@/lib/api";
import { Money, StatusBadge, TxLink, fmtTime, reasonLabel } from "@/lib/ui";

export default function ReceiptsPage() {
  const q = useQuery({ queryKey: ["public-receipts", 50], queryFn: () => get<Receipt[]>("/api/public/receipts?limit=50"), refetchInterval: 5000 });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold">Receipt explorer</h1>
        <p className="text-sm text-on-surface-variant">Every protected call, newest first. Each row links to the Hedera transactions and the HCS receipt behind it.</p>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>When</th><th>Agent</th><th>Merchant</th><th className="text-right">Agent paid</th><th>Latency</th><th>Verdict</th><th className="text-right">HCS</th></tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.paymentId} className="hover:bg-surface-container-low/60">
                <td className="whitespace-nowrap text-xs text-on-surface-variant">{fmtTime(r.createdAt)}</td>
                <td className="font-mono text-xs">{r.agentAccount}</td>
                <td><Link className="font-medium hover:underline" href={`/receipts/${r.paymentId}`}>{r.merchant.name}</Link><div className="text-xs text-on-surface-variant">{r.merchant.slug}</div></td>
                <td className="text-right"><Money micro={r.money.agentPaid} /></td>
                <td className="font-mono text-xs">{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                <td><StatusBadge status={r.status} />{r.reason && <div className="mt-0.5 text-xs text-on-surface-variant">{reasonLabel(r.reason)}</div>}</td>
                <td className="text-right"><TxLink href={r.links.hcs} label={r.hcs.sequence ? `#${r.hcs.sequence}` : undefined} /></td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-on-surface-variant">No calls yet. <Link className="underline" href="/demo">Run one in the sandbox.</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
