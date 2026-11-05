"use client";
import { useQuery } from "@tanstack/react-query";
import { arkivEntityUrl, type PublicMerchant } from "@app/shared";
import { get } from "@/lib/api";
import { Alert, Badge, Money, TxLink, fmtTime } from "@/lib/ui";

type ArkivRep = { key: string; merchantId: string; score: number; totalCalls: number; failedCalls: number; updatedAt: number };
type Reputation = { enabled: boolean; writer: string | null; fetchedAt?: number; error?: string; entities: ArkivRep[] };

export default function MerchantsPage() {
  const q = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 5000 });
  // Read straight from Arkiv: the public, tamper-evident copy of every merchant's track record.
  const rep = useQuery({ queryKey: ["arkiv-reputation"], queryFn: () => get<Reputation>("/api/public/reputation"), refetchInterval: 30_000, retry: 1 });
  const byMerchant = new Map((rep.data?.entities ?? []).map((e) => [e.merchantId, e]));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Merchants</h1>
        <p className="text-sm text-slate-600">
          Every service an agent can pay through Chowkidaar. Reputation is read live from <strong>Arkiv</strong>, a public database
          anyone can query, so you don&apos;t have to trust our numbers. A merchant&apos;s bond pays agents back when a call fails.
        </p>
      </div>

      {rep.data?.enabled && rep.data.writer && (
        <Alert tone="blue">
          Showing records written by our gateway wallet <span className="font-mono text-xs">{rep.data.writer}</span> only
          {rep.data.fetchedAt ? <> · read from Arkiv {fmtTime(rep.data.fetchedAt)}</> : null}.
        </Alert>
      )}
      {(rep.isError || rep.data?.error) && <Alert tone="amber">Arkiv could not be reached right now, so live reputation is missing below. Bonds and prices are still current.</Alert>}

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Merchant</th><th>Price per call</th><th>Reputation (Arkiv)</th><th>Available bond</th><th>Protection</th></tr></thead>
          <tbody>
            {q.data?.map((m) => {
              const r = byMerchant.get(m.id);
              return (
                <tr key={m.id}>
                  <td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.slug}</div></td>
                  <td><Money micro={m.price} /></td>
                  <td>
                    {r ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{r.score}/100</span>
                          {r.totalCalls < 5 && <Badge tone="blue">New</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">{r.totalCalls - r.failedCalls} of {r.totalCalls} calls OK · <TxLink href={arkivEntityUrl(r.key)} label="Verify on Arkiv" /></div>
                      </div>
                    ) : <span className="text-xs text-slate-500">{rep.isLoading ? "Reading Arkiv…" : "No calls yet"}</span>}
                  </td>
                  <td><Money micro={m.bondAvailable} /></td>
                  <td>{m.covered ? <Badge tone="green">Protected</Badge> : <Badge tone="amber">{m.status === "needs_bond" ? "Bond too low" : "Not available"}</Badge>}</td>
                </tr>
              );
            })}
            {q.data?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No merchants yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
