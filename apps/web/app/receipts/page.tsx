"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Receipt } from "@app/shared";
import { get } from "@/lib/api";
import { StatusBadge, TxLink, cx, fmtTime, reasonLabel } from "@/lib/ui";
import { LoadError, PageHeader, ago, usdc } from "@/components/owner/kit";

const KPI = "money truncate font-display text-[40px] font-semibold leading-none tracking-[-0.02em]";

export default function ReceiptsPage() {
  const q = useQuery({ queryKey: ["public-receipts", 50], queryFn: () => get<Receipt[]>("/api/public/receipts?limit=50"), refetchInterval: 5000 });
  const rows = q.data;

  const settled = rows?.filter((r) => r.status !== "calling") ?? [];
  const deliveredPct = settled.length ? Math.round((settled.filter((r) => r.status === "delivered").length / settled.length) * 100) : null;
  const refunded = rows?.reduce((s, r) => s + Number(r.money.refunded), 0) ?? 0;
  const volume = rows?.reduce((s, r) => s + Number(r.money.agentPaid), 0) ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Receipts"
        sub={<span className="block max-w-[68ch]">Every protected call, newest first. Each receipt links to the Hedera transactions and the public record behind it.</span>}
      />

      {!rows && q.isError ? (
        <LoadError what="receipts" retry={() => q.refetch()} />
      ) : (
        <>
          <section className="panel grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
            <Figure value={rows && String(rows.length)} label="Recent calls" />
            <Figure value={rows && (deliveredPct === null ? "None yet" : `${deliveredPct}%`)} label="Delivered first time" />
            <Figure value={rows && usdc(refunded)} label="USDC refunded to agents" accent={refunded > 0} />
            <Figure value={rows && usdc(volume)} label="USDC paid by agents" />
          </section>

          <section className="panel">
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Latest calls</h2>
            {!rows ? (
              <div className="mt-4 space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12" />)}</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-14 text-center text-sm text-on-surface-variant">
                <p>No calls yet. Receipts appear here as soon as an agent pays a merchant.</p>
                <Link className="btn-primary" href="/demo">Run one in the sandbox</Link>
              </div>
            ) : (
              <>
                {/* Phones: one stacked row per call; the whole row opens the receipt. */}
                <ul className="-mx-3 mt-3 divide-y divide-rule sm:hidden">
                  {rows.map((r) => {
                    const back = Number(r.money.refunded) > 0;
                    return (
                      <li key={r.paymentId}>
                        <Link href={`/receipts/${r.paymentId}`} className="block rounded-2xl px-3 py-3 transition-colors hover:bg-surface-container-low">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium">{r.merchant.name}</span>
                            <StatusBadge status={r.status} />
                          </div>
                          <div className="mt-1 flex items-start justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-on-surface-variant">{r.agentName}, {ago(r.createdAt)}</span>
                            <span className="shrink-0 text-right">
                              <span className={cx("money block", back ? "text-on-surface-variant line-through decoration-1" : "font-medium")}>{usdc(r.money.agentPaid)}</span>
                              {back && <span className="money block text-xs text-gain">+{usdc(r.money.refunded)} refunded</span>}
                            </span>
                          </div>
                          {r.reason && <div className="mt-1 text-xs text-on-surface-variant">{reasonLabel(r.reason)}</div>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                <div className="-mx-2 mt-4 hidden overflow-x-auto sm:block">
                  <table className="table min-w-[760px]">
                    <thead>
                      <tr>
                        <th>Merchant</th><th>Agent</th><th>When</th><th className="text-right">Amount</th><th className="text-right">Latency</th><th>Status</th><th className="text-right">Public record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const back = Number(r.money.refunded) > 0;
                        return (
                          // The merchant link stretches over the whole row, so any part of it opens the receipt.
                          <tr key={r.paymentId} className="relative transition-colors hover:bg-surface-container-low">
                            <td>
                              <Link className="flex items-center gap-3 font-medium after:absolute after:inset-0 after:content-['']" href={`/receipts/${r.paymentId}`}>
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-sm font-semibold text-on-surface-variant" aria-hidden>{r.merchant.name.slice(0, 1).toUpperCase()}</span>
                                <span className="min-w-0">
                                  <span className="block truncate">{r.merchant.name}</span>
                                  <span className="block truncate text-xs font-normal text-on-surface-variant">{r.merchant.slug}</span>
                                </span>
                              </Link>
                            </td>
                            <td>
                              <div className="truncate">{r.agentName}</div>
                              <div className="break-all font-mono text-xs text-on-surface-variant">{r.agentAccount}</div>
                            </td>
                            <td className="whitespace-nowrap text-on-surface-variant"><time dateTime={new Date(r.createdAt).toISOString()} title={fmtTime(r.createdAt)}>{ago(r.createdAt)}</time></td>
                            <td className="whitespace-nowrap text-right">
                              <div className={back ? "money text-on-surface-variant line-through decoration-1" : "money font-medium"}>{usdc(r.money.agentPaid)}</div>
                              {back && <div className="money text-xs text-gain">+{usdc(r.money.refunded)} refunded</div>}
                            </td>
                            <td className="money whitespace-nowrap text-right text-on-surface-variant">{r.latencyMs != null ? `${r.latencyMs} ms` : "–"}</td>
                            <td>
                              <StatusBadge status={r.status} />
                              {r.reason && <div className="mt-1 text-xs text-on-surface-variant">{reasonLabel(r.reason)}</div>}
                            </td>
                            <td className="whitespace-nowrap text-right text-xs"><span className="relative z-10"><TxLink href={r.links.hcs} label={r.hcs.sequence ? `#${r.hcs.sequence}` : undefined} /></span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {rows && rows.length > 0 && <p className="mt-4 text-xs text-outline">Showing the latest {rows.length} calls. Amounts in USDC. Public records are on Hedera Consensus Service.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Figure({ value, label, accent }: { value: string | undefined; label: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      {value === undefined ? <div className="skeleton h-10 w-20" /> : <div className={cx(KPI, accent && "text-gain")}>{value}</div>}
      <div className="mt-2 text-sm text-on-surface-variant">{label}</div>
    </div>
  );
}
