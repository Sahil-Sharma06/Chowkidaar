"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { MERCHANT_STATUS_TEXT, type Receipt } from "@app/shared";
import { ApiError, HASHSCAN, get, type MerchantMe } from "@/lib/api";
import { Alert, Badge, CopyButton, Empty, Money, StatusBadge, cx, reasonLabel } from "@/lib/ui";
import { LoadError, PageHeader, Segmented, ago, usdc } from "@/components/owner/kit";

const DAY = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const failed = (p: Receipt) => p.status !== "delivered" && p.status !== "calling";

const STATUS_TONE: Record<string, string> = { live: "green", needs_bond: "amber", testing: "amber", draft: "amber", paused: "amber", suspended: "red" };
const STATUS_WORD: Record<string, string> = { live: "Live", needs_bond: "Needs bond", testing: "Needs test", draft: "Draft", paused: "Paused", suspended: "Suspended" };

const PANEL_TITLE = "font-display text-xl font-semibold tracking-[-0.01em]";
const KPI = "money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]";
const STAT = "money font-display text-2xl font-semibold leading-tight";
/** How many failed calls the coverage bar is drawn against. */
const COVER_SCALE = 10;

type EarnDay = { label: string; long: string; earned: number; today: boolean };

export default function MerchantDashboard() {
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  const payments = useQuery({ queryKey: ["merchant-payments", me.data?.id], queryFn: () => get<Receipt[]>(`/api/merchants/${me.data!.id}/payments`), enabled: Boolean(me.data?.id), refetchInterval: 4000 });

  if (me.isLoading) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 404) {
    return <Empty title="Register your API and agents can start paying for it." action={<Link href="/merchant/setup" className="btn-primary">Set up your service</Link>} />;
  }
  if (!me.data) return <LoadError what="your service" retry={() => me.refetch()} />;
  const m = me.data;

  const list = payments.data ?? [];
  const today = dayStart(Date.now());
  const days: EarnDay[] = Array.from({ length: 7 }, (_, i) => {
    const start = today - (6 - i) * DAY;
    const rows = list.filter((p) => p.createdAt >= start && p.createdAt < start + DAY);
    return {
      label: i === 6 ? "Today" : new Date(start).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
      long: new Date(start).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }),
      earned: rows.reduce((s, p) => s + Number(p.money.merchantReceived), 0),
      today: i === 6,
    };
  });
  const week = days.reduce((s, d) => s + d.earned, 0);
  const slashed = list.reduce((s, p) => s + Number(p.money.bondSlashed), 0);
  const failRate = m.totalCalls ? (m.failedCalls / m.totalCalls) * 100 : null;
  const covers = m.bond.failuresCovered;
  const live = m.status === "live";
  const low = covers < 3;

  const primary = m.status === "needs_bond" ? <Link href="/merchant/bond" className="btn-primary">Post bond</Link>
    : m.status === "draft" || m.status === "testing" ? <Link href="/merchant/setup" className="btn-primary">Finish setup</Link>
    : live && low ? <Link href="/merchant/bond" className="btn-primary">Top up bond</Link>
    : <Link href="/merchant/bond" className="btn-secondary">Manage bond</Link>;

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{m.name}<Badge tone={STATUS_TONE[m.status]}>{STATUS_WORD[m.status] ?? m.status}</Badge></span>}
        sub={MERCHANT_STATUS_TEXT[m.status]}
        actions={<><Link href="/merchant/setup" className="btn-ghost">Edit service</Link>{primary}</>}
      />

      {live && low && (
        <Alert tone="amber">Your bond can refund {covers === 0 ? "no more" : `only ${covers}`} failed {covers === 1 ? "call" : "calls"}. When it runs out, agents stop paying you until you top it up.</Alert>
      )}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <section className="panel lg:col-span-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className={PANEL_TITLE}>Earnings</h2>
              <p className="mt-0.5 text-sm text-on-surface-variant">What agents paid you each day, after fees. Last 7 days.</p>
            </div>
          </div>
          {payments.isError ? (
            <LoadError what="your earnings" retry={() => payments.refetch()} className="mt-6" />
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-[160px_1fr]">
              <div className="flex flex-row items-end justify-between gap-4 sm:flex-col sm:items-start sm:justify-end">
                <div>
                  {payments.data ? <div className={KPI}>{usdc(week)}</div> : <div className="skeleton h-10 w-28" />}
                  <div className="mt-2 text-sm text-on-surface-variant">USDC earned this week</div>
                </div>
                {payments.data && (
                  <div className="space-y-1 text-right text-sm sm:text-left">
                    <div className="money text-on-surface">+{usdc(days[6].earned)} today</div>
                    {slashed > 0 && <div className="money text-on-surface-variant">{usdc(slashed)} refunded from bond</div>}
                  </div>
                )}
              </div>
              <div className="h-64">{payments.data ? <EarnBars days={days} /> : <div className="skeleton h-full" />}</div>
            </div>
          )}
        </section>

        <section className="panel lg:col-span-5">
          <h2 className={PANEL_TITLE}>Health</h2>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <dt className="sr-only">Score</dt>
              <dd className={STAT}>{m.score == null ? "New" : <>{m.score}<span className="ml-1 text-sm font-normal text-on-surface-variant">/&nbsp;100</span></>}</dd>
              <dd className="mt-1 text-sm text-on-surface-variant">{m.score == null ? "Score appears after 5 calls" : "Score, share of calls that passed every check"}</dd>
            </div>
            <div>
              <dt className="sr-only">Calls</dt>
              <dd className={STAT}>{m.totalCalls.toLocaleString()}</dd>
              <dd className="mt-1 text-sm text-on-surface-variant">Calls in total</dd>
            </div>
            <div>
              <dt className="sr-only">Failure rate</dt>
              <dd className={cx(STAT, failRate != null && failRate >= 10 && "text-bad")}>{failRate == null ? "None yet" : `${failRate < 1 && failRate > 0 ? "<1" : Math.round(failRate)}%`}</dd>
              <dd className="money mt-1 text-sm text-on-surface-variant">Failure rate, {m.failedCalls} failed</dd>
            </div>
            <div>
              <dt className="sr-only">Bond coverage</dt>
              <dd className={cx(STAT, low && "text-warn")}>{covers}<span className="ml-1 text-sm font-normal text-on-surface-variant">{covers === 1 ? "failure" : "failures"}</span></dd>
              <dd className="mt-1 text-sm text-on-surface-variant">Your bond still covers</dd>
            </div>
          </dl>
          <CoverBar n={covers} low={low} />
        </section>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <section className="panel lg:col-span-8">
          {payments.isError ? (
            <><h2 className={PANEL_TITLE}>Recent calls</h2><LoadError what="your recent calls" retry={() => payments.refetch()} className="mt-4" /></>
          ) : <Calls rows={payments.data} />}
        </section>
        <section className="panel lg:col-span-4">
          <h2 className={PANEL_TITLE}>Service</h2>
          <dl className="-mx-3 mt-4 space-y-2 sm:-mx-4">
            <Detail label="Agents call" mono copy={`/v1/call/${m.slug}`} copyLabel="Copy call path">/v1/call/{m.slug}</Detail>
            <Detail label="Endpoint" mono copy={m.endpointUrl} copyLabel="Copy endpoint URL">{m.endpointUrl}</Detail>
            <div className="grid grid-cols-2 gap-2">
              <Detail label="Price"><Money micro={m.price} /></Detail>
              <Detail label="Timeout"><span className="money">{m.timeoutMs / 1000}&nbsp;s</span></Detail>
            </div>
            <Detail label="Category"><span className="capitalize">{m.category}</span></Detail>
            <Detail label="Payout account" mono copy={m.payoutAccountId} copyLabel="Copy payout account">
              <a href={`${HASHSCAN}/account/${m.payoutAccountId}`} target="_blank" rel="noreferrer" className="underline decoration-outline underline-offset-4 hover:decoration-on-surface">{m.payoutAccountId}</a>
            </Detail>
          </dl>
          {m.keywords.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">{m.keywords.map((k) => <span key={k} className="pill pill-muted">{k}</span>)}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Chart labels: two decimals is enough to compare days; the sr-only table has exact values. */
const short = (micro: number) => {
  const v = micro / 1e6;
  if (v === 0) return "0";
  if (v < 0.01) return "<0.01";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/** Daily earnings as bars from zero. Every amount is printed above its bar; today is lit. */
function EarnBars({ days }: { days: EarnDay[] }) {
  const max = Math.max(...days.map((d) => d.earned), 0);
  return (
    <figure className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2 border-b border-rule pt-6 sm:gap-3" aria-hidden>
        {days.map((d) => {
          const pct = max > 0 ? (d.earned / max) * 100 : 0;
          return (
            <div key={d.label} className="relative flex justify-center">
              <span className={cx("money absolute inset-x-0 whitespace-nowrap text-center text-xs", d.today ? "font-medium text-on-surface" : "text-on-surface-variant")} style={{ bottom: `calc(${pct}% + 6px)` }}>
                {short(d.earned)}
              </span>
              {d.earned > 0 && (
                <motion.div
                  className={cx("absolute inset-x-0 bottom-0 mx-auto w-full max-w-[44px] origin-bottom rounded-t-xl rounded-b-sm", d.today ? "bg-primary" : "bg-surface-container-highest")}
                  style={{ height: `max(3px, ${pct}%)` }}
                  initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-2 sm:gap-3" aria-hidden>
        {days.map((d) => <span key={d.label} className={cx("text-center text-xs", d.today ? "font-medium text-on-surface" : "text-on-surface-variant")}>{d.label}</span>)}
      </div>
      <figcaption className="mt-2 text-right text-xs text-outline">Days in UTC</figcaption>
      <table className="sr-only">
        <caption>USDC earned per day, last 7 days, days in UTC</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">USDC earned</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.label}><th scope="row">{d.today ? `Today, ${d.long}` : d.long}</th><td>{usdc(d.earned)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** One bar for bond coverage, drawn against a 10-failure scale. Amber when fewer than 3 are left. */
function CoverBar({ n, low }: { n: number; low: boolean }) {
  const pct = Math.min(COVER_SCALE, n) / COVER_SCALE;
  return (
    <div className="mt-6">
      <div className="h-2 overflow-hidden rounded-full bg-surface-container-high" role="meter" aria-valuenow={n} aria-valuemin={0} aria-valuemax={COVER_SCALE} aria-label="Failed calls your bond can still refund">
        <div className={cx("h-full w-full origin-left rounded-full transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]", low ? "bg-warn" : "bg-on-surface-variant")} style={{ transform: `scaleX(${pct})` }} />
      </div>
      <p className="mt-2 text-xs text-outline">Failed calls the bond can still refund, out of {COVER_SCALE}{n > COVER_SCALE ? ` (it covers ${n})` : ""}.</p>
    </div>
  );
}

const FILTERS = [["all", "All"], ["delivered", "Delivered"], ["failed", "Failed"]] as const;
type Filter = (typeof FILTERS)[number][0];

function Calls({ rows }: { rows: Receipt[] | undefined }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows?.filter((p) => filter === "all" || (filter === "delivered" ? p.status === "delivered" : failed(p))).slice(0, 10);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={PANEL_TITLE}>Recent calls</h2>
        <Segmented label="Filter calls" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      {!shown ? <div className="skeleton mt-4 h-48" /> : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-on-surface-variant">
          <p>{filter === "failed" ? "No failed calls. Every agent got what it paid for." : filter === "all" ? "No calls yet. Once you're live, agents that need your API show up here." : "No delivered calls in the latest ones."}</p>
          {filter !== "all" && <button type="button" className="btn-secondary" onClick={() => setFilter("all")}>Show all calls</button>}
        </div>
      ) : (
        <>
          {/* Phones: one stacked row per call, the whole row opens the receipt. */}
          <ul className="-mx-2 mt-3 divide-y divide-rule sm:hidden">
            {shown.map((p) => {
              const bad = failed(p);
              return (
                <li key={p.paymentId}>
                  <Link href={`/receipts/${p.paymentId}`} className="block rounded-2xl px-2 py-3 transition-colors hover:bg-surface-container-low">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{p.agentName}</span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                      <span className="money text-on-surface-variant">{ago(p.createdAt)}, {p.httpStatus ?? "no response"}{p.latencyMs != null && `, ${p.latencyMs} ms`}</span>
                      <span className="money shrink-0">{usdc(p.money.merchantReceived)}</span>
                    </div>
                    {bad && p.reason && <div className="mt-1 text-xs text-bad">{reasonLabel(p.reason)}</div>}
                    {Number(p.money.bondSlashed) > 0 && <div className="money mt-0.5 text-xs text-bad">−{usdc(p.money.bondSlashed)} from your bond</div>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="-mx-2 mt-3 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-on-surface-variant">
                <th className="px-2 pb-3 font-normal">Agent</th><th className="px-2 pb-3 font-normal">When</th><th className="px-2 pb-3 font-normal">Response</th>
                <th className="px-2 pb-3 text-right font-normal">USDC</th><th className="px-2 pb-3 text-right font-normal">Status</th>
              </tr></thead>
              <tbody>{shown.map((p) => {
                const bad = failed(p);
                return (
                  <tr key={p.paymentId} className="border-t border-rule align-top">
                    <td className="px-2 py-3 font-medium">{p.agentName}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-on-surface-variant">{ago(p.createdAt)}</td>
                    <td className="px-2 py-3">
                      <div className="money text-on-surface-variant">{p.httpStatus ?? "No response"}{p.latencyMs != null && <span className="text-outline">, {p.latencyMs}&nbsp;ms</span>}</div>
                      {bad && p.reason && <div className="mt-0.5 text-xs text-bad">{reasonLabel(p.reason)}</div>}
                      {bad && p.detail && <div className="mt-0.5 max-w-[260px] truncate text-xs text-outline" title={p.detail}>{p.detail}</div>}
                      {bad && p.responseHash && <div className="mt-0.5 font-mono text-xs text-outline" title={p.responseHash}>{p.responseHash.slice(0, 16)}…</div>}
                    </td>
                    <td className="money whitespace-nowrap px-2 py-3 text-right">
                      <div>{usdc(p.money.merchantReceived)}</div>
                      {Number(p.money.bondSlashed) > 0 && <div className="mt-0.5 text-xs text-bad">−{usdc(p.money.bondSlashed)} from bond</div>}
                    </td>
                    <td className="px-2 py-3 text-right"><Link href={`/receipts/${p.paymentId}`} aria-label={`Receipt for the call from ${p.agentName}`} className="inline-flex min-h-10 items-center rounded-full hover:opacity-80"><StatusBadge status={p.status} /></Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
      {filter === "failed" && <p className="mt-4 text-xs text-outline">A failed check is final in this version. Disputes aren&apos;t supported yet.</p>}
    </>
  );
}

function Detail({ label, children, mono, copy, copyLabel }: { label: string; children: React.ReactNode; mono?: boolean; copy?: string; copyLabel?: string }) {
  return (
    <div className="well grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-2.5 pl-3.5 pr-1.5">
      <dt className="col-start-1 text-xs text-on-surface-variant">{label}</dt>
      <dd className="col-start-1 row-start-2 min-w-0">
        <span className={cx("mt-0.5 block break-all text-sm", mono && "font-mono text-[13px]")}>{children}</span>
      </dd>
      {copy && <dd className="col-start-2 row-span-2 row-start-1"><CopyButton text={copy} label={copyLabel} /></dd>}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-10 w-64" />
      <div className="grid gap-5 lg:grid-cols-12"><div className="skeleton h-80 lg:col-span-7" /><div className="skeleton h-80 lg:col-span-5" /></div>
    </div>
  );
}
