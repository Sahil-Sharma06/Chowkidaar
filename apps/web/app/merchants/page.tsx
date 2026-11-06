"use client";
import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { arkivEntityUrl, type PublicMerchant } from "@app/shared";
import { get } from "@/lib/api";
import { Alert, cx, fmtTime } from "@/lib/ui";
import { LoadError, PageHeader, usdc } from "@/components/owner/kit";
import { Gauge } from "@/components/owner/charts";

type ArkivRep = { key: string; merchantId: string; score: number; totalCalls: number; failedCalls: number; updatedAt: number };
type Reputation = { enabled: boolean; writer: string | null; fetchedAt?: number; error?: string; entities: ArkivRep[] };

const okScore = (m: PublicMerchant) => (m.totalCalls > 0 ? Math.round((100 * (m.totalCalls - m.failedCalls)) / m.totalCalls) : null);

const KPI = "money truncate font-display text-[40px] font-semibold leading-none tracking-[-0.02em]";

export default function MerchantsPage() {
  return <Suspense fallback={<Fallback />}><Directory /></Suspense>;
}

function Fallback() {
  return (
    <div className="space-y-4 sm:space-y-5" aria-busy>
      <div className="skeleton h-16 w-72" />
      <div className="skeleton h-28 rounded-[24px]" />
      <div className="skeleton h-96 rounded-[24px]" />
    </div>
  );
}

function Directory() {
  // Counters update the moment a call finishes; the Arkiv copy follows a few seconds later.
  const q = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 3000 });
  // Read straight from Arkiv: the public, tamper-evident copy of every merchant's track record.
  const rep = useQuery({ queryKey: ["arkiv-reputation"], queryFn: () => get<Reputation>("/api/public/reputation"), refetchInterval: 5000, retry: 1 });
  const byMerchant = new Map((rep.data?.entities ?? []).map((e) => [e.merchantId, e]));

  // The category lives in the URL (?category=food), so a filtered list can be shared or bookmarked.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const category = params.get("category") ?? "all";
  const setCategory = (c: string) => {
    const next = new URLSearchParams(params.toString());
    if (c === "all") next.delete("category"); else next.set("category", c);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const [term, setTerm] = useState("");
  const all = q.data;
  const categories = useMemo(() => [...new Set((all ?? []).map((m) => m.category))].sort(), [all]);
  const needle = term.trim().toLowerCase();
  const shown = all?.filter((m) =>
    (category === "all" || m.category === category) &&
    (!needle || [m.name, m.slug, m.description ?? "", m.category, ...m.keywords].some((s) => s.toLowerCase().includes(needle))),
  );

  const protectedCount = all?.filter((m) => m.covered).length ?? 0;
  const bondTotal = all?.reduce((s, m) => s + Number(m.bondAvailable), 0) ?? 0;
  const calls = all?.reduce((s, m) => s + m.totalCalls, 0) ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Merchants"
        sub={<span className="block max-w-[68ch]">Every service an agent can pay through Chowkidaar. Each merchant posts a bond that pays agents back when a call fails.</span>}
      />

      {!all && q.isError ? null : (
        <section className="panel grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Figure value={all && String(all.length)} label="Merchants listed" />
          <Figure value={all && String(protectedCount)} label="Protected by a bond" />
          <Figure value={all && usdc(bondTotal)} label="USDC of bond available" />
          <Figure value={all && calls.toLocaleString()} label="Calls served" />
        </section>
      )}

      {(rep.isError || rep.data?.error) && (
        <Alert tone="amber">
          Arkiv couldn&apos;t be reached, so live reputation is missing below. Bonds and prices are still current.{" "}
          <button type="button" className="-my-2 inline-flex min-h-10 items-center font-medium underline underline-offset-4" onClick={() => rep.refetch()}>Try Arkiv again</button>
        </Alert>
      )}

      <section className="panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
            {["all", ...categories].map((c) => (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                className={cx("h-10 rounded-full px-4 text-sm capitalize transition-colors duration-150", category === c ? "bg-surface-container-highest font-medium text-on-surface" : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface")}>
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>
          <label className="relative block w-full lg:w-72">
            <span className="sr-only">Search merchants</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
            <input className="input rounded-full pl-10" placeholder="Search by name or what it does" value={term} onChange={(e) => setTerm(e.target.value)} />
          </label>
        </div>

        <div className="mt-5 hidden grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] gap-4 px-3 pb-3 text-xs text-on-surface-variant lg:grid">
          <span>Merchant</span><span>Category</span><span className="text-right">Price per call</span><span>Delivered</span><span className="text-right">Bond</span>
        </div>

        {!shown && q.isError ? (
          <LoadError what="merchants" retry={() => q.refetch()} className="mt-4" />
        ) : !shown ? (
          <div className="mt-4 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16" />)}</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-14 text-center text-sm text-on-surface-variant">
            <p>
              {all?.length === 0 ? "No merchants yet. The first one to post a bond shows up here."
                : needle && category !== "all" ? <>No {category} merchant matches &ldquo;{term.trim()}&rdquo;.</>
                : needle ? <>No merchant matches &ldquo;{term.trim()}&rdquo;.</>
                : <>No merchants in {category} right now.</>}
            </p>
            {all && all.length > 0 && <button type="button" className="btn-secondary" onClick={() => { setTerm(""); setCategory("all"); }}>Show all merchants</button>}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-rule lg:mt-0">
            {shown.map((m) => {
              const r = byMerchant.get(m.id);
              const score = okScore(m);
              return (
                <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-1 py-4 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] lg:px-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-display text-base font-semibold text-on-surface">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium">{m.name}</div>
                      <div className="truncate text-sm text-on-surface-variant">{m.description ?? m.slug}</div>
                    </div>
                  </div>

                  <div className="hidden lg:block"><span className="pill pill-muted">{m.category}</span></div>

                  <div className="text-right">
                    <div className="money text-[15px] font-medium">{usdc(m.price)} <span className="text-xs font-normal text-on-surface-variant">USDC</span></div>
                    {!m.covered && <div className="mt-1 lg:hidden"><span className="pill pill-warn">{m.status === "needs_bond" ? "Bond too low" : "Not available"}</span></div>}
                  </div>

                  <div className="col-span-2 flex items-center gap-3 pl-[52px] lg:col-span-1 lg:pl-0">
                    {score === null || m.totalCalls < 5 ? (
                      <div>
                        <div className="text-[15px] font-medium text-on-surface-variant">New</div>
                        <div className="money text-xs text-outline">{m.totalCalls === 0 ? "No calls yet" : `${m.totalCalls - m.failedCalls} of ${m.totalCalls} calls worked`}</div>
                      </div>
                    ) : (
                      <>
                        <Gauge pct={score} className="h-7 w-14 shrink-0" />
                        <div className="min-w-0">
                          <div className="money text-[15px] font-semibold">{score}%</div>
                          <div className="money flex items-center gap-1.5 text-xs text-on-surface-variant">
                            {m.totalCalls - m.failedCalls} of {m.totalCalls} worked
                            {r && r.totalCalls >= m.totalCalls && (
                              <a href={arkivEntityUrl(r.key)} target="_blank" rel="noreferrer" aria-label={`Verify ${m.name}'s record on Arkiv`}
                                className="-my-2 inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-1.5 text-outline transition-colors hover:bg-surface-container hover:text-on-surface">
                                <ShieldCheck className="h-4 w-4" aria-hidden /><span className="hidden lg:inline">Verify</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="hidden text-right lg:block">
                    <div className="money text-[15px]">{usdc(m.bondAvailable)} <span className="text-xs text-on-surface-variant">USDC</span></div>
                    {!m.covered && <div className="mt-1"><span className="pill pill-warn">{m.status === "needs_bond" ? "Bond too low" : "Not available"}</span></div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="max-w-[75ch] px-1 text-xs leading-relaxed text-outline">
        Delivery records are read live from Arkiv, a public database anyone can query. Use Verify next to a record to check it yourself.
        {rep.data?.enabled && rep.data.writer && (
          <> Only records written by our gateway wallet <span className="break-all font-mono">{rep.data.writer}</span> are shown{rep.data.fetchedAt ? `, last read ${fmtTime(rep.data.fetchedAt)}` : ""}.</>
        )}
      </p>
    </div>
  );
}

function Figure({ value, label }: { value: string | undefined; label: string }) {
  return (
    <div className="min-w-0">
      {value === undefined ? <div className="skeleton h-10 w-20" /> : <div className={KPI}>{value}</div>}
      <div className="mt-2 text-sm text-on-surface-variant">{label}</div>
    </div>
  );
}
