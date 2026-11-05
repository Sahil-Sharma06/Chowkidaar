"use client";
import { useQuery } from "@tanstack/react-query";
import { arkivEntityUrl, type PublicMerchant } from "@app/shared";
import { get } from "@/lib/api";
import { Badge, Money, TxLink } from "@/lib/ui";

export default function MerchantsPage() {
  const q = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 5000 });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Merchant directory</h1>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Merchant</th><th>Price</th><th>Score</th><th>Calls</th><th>Available bond</th><th>Coverage</th><th>Arkiv</th></tr></thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id}>
                <td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.slug}</div></td>
                <td><Money micro={m.price} /></td>
                <td>{m.score ?? <Badge tone="blue">New</Badge>}</td>
                <td>{m.totalCalls} <span className="text-xs text-slate-500">({m.failedCalls} failed)</span></td>
                <td><Money micro={m.bondAvailable} /></td>
                <td>{m.status !== "live" ? <Badge tone="grey">{m.status}</Badge> : m.covered ? <Badge tone="green">Covered</Badge> : <Badge tone="amber">Not covered</Badge>}</td>
                <td>{m.arkivEntityKey ? <TxLink href={arkivEntityUrl(m.arkivEntityKey)} label="Entity" /> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
            {q.data?.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No merchants yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
