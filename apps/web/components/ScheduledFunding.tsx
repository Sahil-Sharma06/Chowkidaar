"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, ExternalLink } from "lucide-react";
import { formatUsdc } from "@app/shared";
import { ApiError, HASHSCAN, get, post, type Config, type ScheduledTopUp } from "@/lib/api";
import { cx } from "@/lib/ui";

const EVERY = [["120", "2 minutes"], ["3600", "hour"], ["86400", "day"], ["604800", "week"]] as const;
const ERROR: Record<string, string> = {
  not_in_demo_mode: "Scheduled top-ups are only available on testnet.",
  not_custodial: "Only wallets we hold for you can be topped up on a schedule.",
  schedule_failed: "Hedera didn't accept the schedule. Check the gateway has test USDC and try again.",
  validation_error: "Use 0.1 to 5 USDC per top-up, up to 8 times, reaching at most 62 days ahead.",
};

/** "in 2 min", "in 3 h", "in 4 days" for upcoming top-ups; dates for anything further. */
function until(t: number, now: number) {
  const s = Math.round((t - now) / 1000);
  if (s < 60) return "in under a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86_400) return `in ${Math.round(s / 3600)} h`;
  if (s < 7 * 86_400) return `in ${Math.round(s / 86_400)} days`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Top-ups queued as Hedera Scheduled Transactions: each one is created on-chain up front and the
 * network executes it at its time, whether or not the gateway is running.
 */
export function ScheduledFunding({ agentId, scheduled }: { agentId: string; scheduled: ScheduledTopUp[] }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const [f, setF] = useState({ amount: "0.5", everySec: "3600", times: "3" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const amount = Number(f.amount), times = Number(f.times), every = Number(f.everySec);
  const valid = amount >= 0.1 && amount <= 5 && Number.isInteger(times) && times >= 1 && times <= 8 && every * times <= 62 * 86_400;
  const schedule = useMutation({
    mutationFn: () => post<{ created: ScheduledTopUp[] }>(`/api/agents/${agentId}/fund/schedule`, { amount: Math.round(amount * 1e6), everySec: every, times }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent", agentId] }),
  });
  const err = schedule.error instanceof ApiError ? ERROR[schedule.error.code] : undefined;

  if (cfg.data && !cfg.data.features.demoMode) return null;
  const upcoming = scheduled.filter((s) => s.executeAt > now);
  const done = scheduled.filter((s) => s.executeAt <= now);

  return (
    <section aria-labelledby="sched-title" className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[60ch]">
          <h2 id="sched-title" className="font-display text-xl font-semibold tracking-[-0.01em]">Scheduled top-ups</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Queue test USDC for this wallet as Hedera Scheduled Transactions. The network moves the money at each time, even if Chowkidaar is offline.
          </p>
        </div>
        {upcoming.length > 0 && (
          <span className="money pill pill-muted">{upcoming.length} pending, {formatUsdc(upcoming.reduce((t, s) => t + s.amount, 0))}</span>
        )}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The form reads as a sentence: "Add 0.5 USDC every hour, 3 times". */}
        <form className="well space-y-4 p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); if (valid) schedule.mutate(); }}>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-3 text-[15px]">
            <span>Add</span>
            <label className="relative">
              <span className="sr-only">USDC per top-up</span>
              <input className="input money h-10 w-24 pr-12 text-right" inputMode="decimal" value={f.amount} aria-invalid={!(amount >= 0.1 && amount <= 5) || undefined}
                onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-outline">USDC</span>
            </label>
            <span>every</span>
            <label>
              <span className="sr-only">How often</span>
              <select className="input h-10 w-auto" value={f.everySec} onChange={(e) => setF({ ...f, everySec: e.target.value })}>
                {EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <span>,</span>
            <label className="relative">
              <span className="sr-only">How many times</span>
              <input className="input money h-10 w-20 pr-12 text-right" type="number" min={1} max={8} value={f.times}
                onChange={(e) => setF({ ...f, times: e.target.value })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-outline">times</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={!valid || schedule.isPending}>
              <CalendarClock className="h-4 w-4" aria-hidden /> {schedule.isPending ? "Scheduling on Hedera…" : "Schedule top-ups"}
            </button>
            <span className="money text-xs text-on-surface-variant">
              {valid ? <>{formatUsdc(Math.round(amount * times * 1e6))} in total, first {until(now + every * 1000, now)}</> : "0.1 to 5 USDC each, up to 8 times, within 62 days."}
            </span>
          </div>
          <div role="status" className="text-sm">
            {schedule.isSuccess && <span className="text-gain">Scheduled {schedule.data.created.length} top-ups on Hedera.</span>}
          </div>
          {schedule.isError && <p role="alert" className="text-sm text-bad">{err ?? "Couldn't schedule the top-ups. Check your connection and try again."}</p>}
        </form>

        {/* The queue as a timeline: what's still to come, then what the network already ran. */}
        <div className="min-w-0">
          {scheduled.length === 0 ? (
            <div className="flex h-full min-h-32 items-center justify-center rounded-2xl border border-dashed border-rule px-6 py-8 text-center text-sm text-on-surface-variant">
              Nothing scheduled. Queued top-ups appear here with their Hedera schedule.
            </div>
          ) : (
            <ol className="relative space-y-0">
              {[...upcoming, ...done.reverse()].slice(0, 8).map((s, i, all) => {
                const fired = s.executeAt <= now;
                return (
                  <li key={s.scheduleId} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < all.length - 1 && <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-px bg-rule" />}
                    <span className={cx("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", fired ? "bg-ok-subtle text-ok" : "border border-rule-strong bg-surface-container-lowest text-on-surface-variant")}>
                      {fired ? <Check className="h-3.5 w-3.5" aria-label="Executed" /> : <CalendarClock className="h-3 w-3" aria-label="Pending" />}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4">
                      <div className="min-w-0">
                        <div className="money text-sm font-medium">+{formatUsdc(s.amount)}</div>
                        <div className="text-xs text-on-surface-variant">
                          {fired ? "Executed" : until(s.executeAt, now)}, {new Date(s.executeAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                      <a className="inline-flex min-h-8 items-center gap-1 font-mono text-xs text-on-surface-variant underline decoration-outline underline-offset-4 hover:text-on-surface"
                        href={`${HASHSCAN}/schedule/${s.scheduleId}`} target="_blank" rel="noreferrer">
                        {s.scheduleId} <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens HashScan)</span>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
