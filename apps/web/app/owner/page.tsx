"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Receipt } from "@app/shared";
import { MIRROR_URL, USDC_ID, get, type AgentRow } from "@/lib/api";
import { cx } from "@/lib/ui";
import { ApprovalQueue, LoadError, PageHeader, Segmented, ago, usdc, useApprovals } from "@/components/owner/kit";
import { BudgetBars, Spark, Ticks, type Day } from "@/components/owner/charts";

const DAY = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const net = (p: Receipt) => Number(p.money.agentPaid) - Number(p.money.refunded);
/** Two decimals for the labels above the bars, where a column is ~40px wide. */
const short = (m: number) => (m === 0 ? "0" : m < 10_000 ? "<0.01" : (m / 1_000_000).toFixed(2));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function OwnerOverview() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents"), refetchInterval: 8000 });
  const payments = useQuery({ queryKey: ["owner-payments"], queryFn: () => get<Receipt[]>("/api/owner/payments"), refetchInterval: 4000 });
  const pending = useApprovals().data?.length ?? 0;
  const balances = useQueries({
    queries: (agents.data ?? []).map((a) => ({
      queryKey: ["usdc", a.hederaAccountId], refetchInterval: 10_000,
      queryFn: async () => {
        const r = await fetch(`${MIRROR_URL}/api/v1/accounts/${a.hederaAccountId}/tokens?token.id=${USDC_ID}`);
        if (!r.ok) throw new Error(`mirror ${r.status}`); // a failed lookup is "unknown", never a zero balance
        const j = (await r.json()) as { tokens: { balance: number }[] };
        return j?.tokens?.[0]?.balance ?? 0;
      },
    })),
  });

  if (agents.isError && !agents.data) {
    return <div><PageHeader title="Overview" /><LoadError what="your agents" retry={() => agents.refetch()} /></div>;
  }
  if (!agents.data) return <OverviewSkeleton />;
  if (agents.data.length === 0) return <FirstRun />;

  const list = payments.data ?? [];
  const loaded = Boolean(payments.data);
  const today = dayStart(Date.now());
  const caps = agents.data.reduce((s, a) => s + a.dailyCap, 0);
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const start = today - (6 - i) * DAY;
    const spent = list.filter((p) => p.createdAt >= start && p.createdAt < start + DAY).reduce((s, p) => s + net(p), 0);
    return { label: i === 6 ? "Today" : new Date(start).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }), spent, cap: caps, today: i === 6 };
  });
  const todayRows = list.filter((p) => p.createdAt >= today);
  const spentToday = days[6].spent, spentYesterday = days[5].spent;
  const settled = list.filter((p) => p.status !== "calling");
  const delivered = settled.filter((p) => p.status === "delivered").length;
  const refunds7 = days.map((_, i) => list.filter((p) => p.createdAt >= today - (6 - i) * DAY && p.createdAt < today - (5 - i) * DAY).reduce((s, p) => s + Number(p.money.refunded), 0));
  const refundedWeek = refunds7.reduce((a, b) => a + b, 0);
  const hours = Array.from({ length: 12 }, (_, i) => { const end = Date.now() - (11 - i) * 3_600_000; return list.filter((p) => p.createdAt > end - 3_600_000 && p.createdAt <= end).length; });
  const balanceFailed = balances.some((b) => b.isError && b.data === undefined);
  const balance = balances.every((b) => b.data !== undefined) ? balances.reduce((s, b) => s + (b.data ?? 0), 0) : null;
  const change = spentYesterday > 0 ? Math.round(((spentToday - spentYesterday) / spentYesterday) * 100) : null;
  const runway = balance !== null && caps > 0 ? balance / caps : null;

  const summary = !loaded ? (payments.isError ? "Your payments didn't load." : <span className="skeleton inline-block h-4 w-72 max-w-full align-middle" aria-label="Loading today's summary" />) : (
    <>
      {todayRows.length === 0 ? "No payments yet today." : `Your agents made ${plural(todayRows.length, "payment", "payments")} today and spent ${usdc(spentToday)} USDC.`}
      {pending > 0 && ` ${plural(pending, "payment is", "payments are")} waiting for your approval.`}
    </>
  );

  return (
    <div>
      <PageHeader title="Overview" sub={summary} actions={<>
        <Link href="/console" className="btn-secondary">Open console</Link>
        <Link href="/owner/agents/new" className="btn-primary">New agent</Link>
      </>} />

      <div className="space-y-4 sm:space-y-5">
        <Suspense><ApprovalQueue asPanel /></Suspense>

        {payments.isError && !payments.data ? (
          <LoadError what="your payments" retry={() => payments.refetch()} />
        ) : (
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
            <section className="panel lg:col-span-7" aria-labelledby="spending-heading">
              <PanelHead id="spending-heading" title="Spending" aside={<span className="text-xs text-on-surface-variant">Last 7 days</span>} />
              <div className="mt-6 grid gap-6 sm:grid-cols-[150px_1fr]">
                <div className="flex flex-row items-end justify-between gap-4 sm:flex-col sm:items-start sm:justify-end">
                  <div>
                    {loaded
                      ? <div className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{usdc(spentToday)}</div>
                      : <div className="skeleton h-10 w-28" />}
                    <div className="mt-2 text-sm text-on-surface-variant">USDC spent today</div>
                  </div>
                  {loaded && change !== null && (
                    <div className="money text-sm text-on-surface-variant">
                      {change === 0 ? "Same as yesterday" : `${Math.abs(change)}% ${change > 0 ? "more" : "less"} than yesterday`}
                    </div>
                  )}
                </div>
                <div className="h-60">{loaded ? <BudgetBars days={days} format={short} full={usdc} /> : <div className="skeleton h-full" />}</div>
              </div>
              <p className="mt-4 text-xs text-outline">
                Each column is the combined daily budget of <span className="money">{usdc(caps)}&nbsp;USDC</span>; the fill is what was spent. Days in UTC.
              </p>
            </section>

            <section className="panel overflow-hidden p-0 sm:p-0 lg:col-span-5" aria-label="Key figures">
              <dl className="grid h-full grid-cols-1 gap-px bg-rule min-[420px]:grid-cols-2">
                <Figure value={balance === null ? (balanceFailed ? null : undefined) : usdc(balance)} unit="USDC" label="In agent wallets"
                  caption={balanceFailed ? "Couldn't reach Hedera to read balances." : runway !== null ? `About ${runway < 10 ? runway.toFixed(1) : Math.round(runway)} days of budget at full spend.` : undefined} />
                <Figure value={loaded ? String(todayRows.length) : undefined} label="Payments today"
                  viz={loaded && <Ticks values={hours} className="h-8" label={`Payments per hour, last 12 hours: ${hours.join(", ")}`} />}
                  caption="Per hour, last 12 hours" />
                <Figure value={loaded ? usdc(refundedWeek) : undefined} unit="USDC" label="Refunded this week"
                  viz={loaded && refundedWeek > 0 && <Spark values={refunds7} area className="h-8 w-full max-w-28" label={`Refunds per day, last 7 days: ${refunds7.map((v) => usdc(v)).join(", ")} USDC`} />}
                  caption={refundedWeek > 0 ? "Per day, from merchant bonds" : "No service failed to deliver."} />
                <Figure value={loaded ? (settled.length ? `${Math.round((delivered / settled.length) * 100)}%` : "None yet") : undefined} label="Delivered first time"
                  caption={settled.length ? `${delivered} of ${plural(settled.length, "recent payment", "recent payments")}` : "Shows once a payment settles."} />
              </dl>
            </section>
          </div>
        )}

        <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
          {!(payments.isError && !payments.data) && <section className="panel lg:col-span-7" aria-labelledby="payments-heading"><Payments rows={payments.data} /></section>}
          <section className={cx("panel", payments.isError && !payments.data ? "lg:col-span-12" : "lg:col-span-5")} aria-labelledby="agents-heading">
            <PanelHead id="agents-heading" title="Agents" aside={<span className="text-xs text-on-surface-variant">Wallet balance</span>} />
            <ul className="-mx-3 mt-4 space-y-1 sm:-mx-4">
              {agents.data.map((a, i) => {
                const b = balances[i];
                return (
                  <li key={a.id}>
                    <Link href={`/owner/agents/${a.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface-container-low sm:px-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-sm font-semibold text-on-surface-variant" aria-hidden>{a.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        <div className="money text-xs text-on-surface-variant">
                          {a.status === "paused" ? <span className="text-warn">Paused</span> : `${usdc(a.spentToday)} of ${usdc(a.dailyCap)} USDC spent today`}
                        </div>
                      </div>
                      <span className="money shrink-0 text-sm">
                        {b?.data !== undefined ? <>{usdc(b.data)}<span className="ml-1 text-xs text-on-surface-variant">USDC</span></>
                          : b?.isError ? <span className="text-xs text-outline">Unavailable</span>
                          : <span className="skeleton inline-block h-4 w-12 align-middle" />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A figure with what it means in words under it. `value` undefined = loading, null = couldn't load. */
function Figure({ value, unit, label, caption, viz }: { value: string | null | undefined; unit?: string; label: string; caption?: string; viz?: React.ReactNode }) {
  return (
    <div className="flex flex-col bg-surface-container-lowest p-5 sm:p-6">
      <dt className="sr-only">{label}</dt>
      <dd className="flex flex-1 flex-col gap-3">
        <div>
          {value === undefined ? <div className="skeleton h-8 w-20" />
            : value === null ? <div className="font-display text-2xl font-semibold leading-tight text-on-surface-variant">Unavailable</div>
            : <div className="money font-display text-2xl font-semibold leading-tight">{value}{unit && value !== "None yet" && <span className="ml-1.5 text-sm font-normal text-on-surface-variant">{unit}</span>}</div>}
          <div className="mt-1 text-sm text-on-surface-variant" aria-hidden>{label}</div>
        </div>
        {(viz || caption) && (
          <div className="mt-auto space-y-2">
            {viz}
            {caption && <p className="text-xs text-outline">{caption}</p>}
          </div>
        )}
      </dd>
    </div>
  );
}

const STATUS_PILL: Record<string, [string, string]> = {
  delivered: ["Delivered", "pill-ok"],
  calling: ["In progress", "pill-info"],
  refund_pending: ["Refunding", "pill-warn"],
  refunded: ["Refunded", "pill-info"],
  refund_failed: ["Refund failed", "pill-bad"],
};

const FILTERS = [["all", "All"], ["delivered", "Delivered"], ["refunded", "Refunded"]] as const;
type Filter = (typeof FILTERS)[number][0];

function Payments({ rows }: { rows: Receipt[] | undefined }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows?.filter((p) => filter === "all" || (filter === "delivered" ? p.status === "delivered" : p.status.startsWith("refund"))).slice(0, 8);
  return (
    <>
      <PanelHead id="payments-heading" title="Recent payments" aside={<Segmented label="Show payments" value={filter} onChange={setFilter} options={FILTERS} />} />
      {!shown ? <div className="skeleton mt-4 h-48" /> : shown.length === 0 ? (
        filter === "all" ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-on-surface-variant">
            <p>No payments yet. Ask an agent for something in the console.</p>
            <Link href="/console" className="btn-secondary">Open console</Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-on-surface-variant">
            <p>No {filter} payments yet.</p>
            <button type="button" className="btn-secondary" onClick={() => setFilter("all")}>Show all</button>
          </div>
        )
      ) : (
        <>
          {/* Phones: two lines per payment, nothing to scroll sideways. */}
          <ul className="-mx-3 mt-3 divide-y divide-rule sm:hidden">
            {shown.map((p) => {
              const [label, cls] = STATUS_PILL[p.status] ?? [p.status, "pill-muted"];
              const back = Number(p.money.refunded) > 0;
              return (
                <li key={p.paymentId}>
                  <Link href={`/receipts/${p.paymentId}`} className="block space-y-1.5 rounded-2xl px-3 py-3 transition-colors hover:bg-surface-container-low">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{p.merchant.name}</span>
                      <span className={cx("pill", cls)}>{label}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-on-surface-variant">
                      <span className="truncate">{p.agentName}, {ago(p.createdAt)}</span>
                      <span className={cx("money text-sm", back ? "text-on-surface-variant line-through" : "text-on-surface")}>{usdc(p.money.agentPaid)}&nbsp;USDC</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="-mx-3 mt-3 hidden overflow-x-auto sm:block">
            <table className="table">
              <thead><tr>
                <th scope="col">Merchant</th><th scope="col">Agent</th><th scope="col">When</th>
                <th scope="col" className="text-right">USDC</th><th scope="col" className="text-right">Status</th>
              </tr></thead>
              <tbody>{shown.map((p) => {
                const [label, cls] = STATUS_PILL[p.status] ?? [p.status, "pill-muted"];
                const back = Number(p.money.refunded) > 0;
                return (
                  <tr key={p.paymentId}>
                    <td><Link href={`/receipts/${p.paymentId}`} className="font-medium hover:text-primary">{p.merchant.name}</Link></td>
                    <td className="text-on-surface-variant">{p.agentName}</td>
                    <td className="whitespace-nowrap text-on-surface-variant">{ago(p.createdAt)}</td>
                    <td className="money text-right">{back ? <span className="text-on-surface-variant line-through">{usdc(p.money.agentPaid)}</span> : usdc(p.money.agentPaid)}</td>
                    <td className="text-right"><span className={cx("pill", cls)}>{label}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function PanelHead({ id, title, aside }: { id?: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 id={id} className="font-display text-xl font-semibold tracking-[-0.01em]">{title}</h2>
      {aside}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your overview">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <div className="space-y-3"><div className="skeleton h-9 w-48" /><div className="skeleton h-4 w-72 max-w-full" /></div>
        <div className="flex gap-2"><div className="skeleton h-10 w-32 rounded-full" /><div className="skeleton h-10 w-28 rounded-full" /></div>
      </div>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <div className="skeleton h-[380px] rounded-[24px] lg:col-span-7" />
        <div className="skeleton h-[380px] rounded-[24px] lg:col-span-5" />
        <div className="skeleton h-72 rounded-[24px] lg:col-span-7" />
        <div className="skeleton h-72 rounded-[24px] lg:col-span-5" />
      </div>
    </div>
  );
}

const STEPS = [
  ["Create an agent", "Give it a name, a wallet on Hedera and the limits it has to stay inside."],
  ["Add funds", "Top the wallet up with test USDC in one tap, or send your own."],
  ["Ask for something", "Type a request in the console. The agent picks a merchant and pays."],
] as const;

/** First visit: what the product does, and the three steps to see it work. */
function FirstRun() {
  return (
    <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
      <section className="panel flex flex-col justify-between gap-10 lg:col-span-7 lg:p-10">
        <div>
          <h1 className="max-w-md font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">Give your first agent a budget</h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-on-surface-variant">
            Your agent pays for APIs on its own, but never past the limits you set. If a service fails to deliver, the money comes back from the merchant&apos;s bond.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/owner/agents/new" className="btn-primary px-5">Create an agent</Link>
          <Link href="/merchants" className="btn-ghost">See what agents can buy</Link>
        </div>
      </section>
      <section className="panel lg:col-span-5">
        <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Up and running in three steps</h2>
        <ol className="-mx-3 mt-5 space-y-2 sm:-mx-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="well flex gap-4 p-4">
              <span className="money flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-sm font-semibold text-on-surface-variant">{i + 1}</span>
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="mt-0.5 text-sm text-on-surface-variant">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
