"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, ExternalLink, Minus, Repeat, X } from "lucide-react";
import { POLICY_ERROR_LABEL, formatUsdc, type PublicMerchant } from "@app/shared";
import { ApiError, HASHSCAN, del, get, post, type AgentRow, type SubscriptionRow } from "@/lib/api";
import { StatusBadge, cx } from "@/lib/ui";
import { LoadError, usdc } from "@/components/owner/kit";

const EVERY = [["120", "2 minutes"], ["3600", "hour"], ["86400", "day"], ["604800", "week"]] as const;
const everyLabel = (sec: number) => EVERY.find(([v]) => v === String(sec))?.[1] ?? `${Math.round(sec / 60)} minutes`;
const ERROR: Record<string, string> = {
  schedule_failed: "Hedera didn't accept the schedule. Check the agent's wallet has enough USDC and try again.",
  not_custodial: "Only agents with a wallet we hold can schedule payments.",
  validation_error: "Use up to 8 runs, every 2 minutes or more, reaching at most 62 days ahead.",
};

function until(t: number, now: number) {
  const s = Math.round((t - now) / 1000);
  if (s < 60) return "in under a minute";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86_400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86_400)} days`;
}
const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Subscriptions: recurring protected calls to one merchant. The agent signs one Hedera Scheduled
 * Transaction per run up front; the network pays at each time and the gateway then makes the call,
 * with the same refund guarantee as any other payment.
 */
export function Subscriptions({ agent, merchants }: { agent: AgentRow; merchants: PublicMerchant[] }) {
  const qc = useQueryClient();
  const key = ["subscriptions", agent.id];
  const subs = useQuery({ queryKey: key, queryFn: () => get<SubscriptionRow[]>(`/api/agents/${agent.id}/subscriptions`), refetchInterval: 5000 });
  // Merchants this agent may actually pay: live, and on its list when the list is on.
  const choices = merchants.filter((m) => m.status === "live" && (!agent.allowlistOnly || agent.allowedMerchantIds.includes(m.id)));
  const [f, setF] = useState({ slug: "", everySec: "3600", times: "3", query: "" });
  const slug = f.slug || choices[0]?.slug || "";
  const merchant = choices.find((m) => m.slug === slug);
  const times = Number(f.times), every = Number(f.everySec);
  const valid = Boolean(merchant) && Number.isInteger(times) && times >= 1 && times <= 8 && every * times <= 62 * 86_400;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const subscribe = useMutation({
    mutationFn: () => post<SubscriptionRow>(`/api/agents/${agent.id}/subscribe`, { slug, everySec: every, times, body: f.query.trim() ? { query: f.query.trim() } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setF((x) => ({ ...x, query: "" })); },
  });
  const [confirming, setConfirming] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => del(`/api/agents/${agent.id}/subscriptions/${id}`),
    onSuccess: () => { setConfirming(null); qc.invalidateQueries({ queryKey: key }); },
  });
  const subError = subscribe.error instanceof ApiError
    ? ERROR[subscribe.error.code] ?? (POLICY_ERROR_LABEL[subscribe.error.code] ? `Blocked by this agent's limits: ${POLICY_ERROR_LABEL[subscribe.error.code].toLowerCase()}.` : undefined)
    : undefined;
  const fee = merchant ? Math.floor(Number(merchant.price) * 0.02) : 0;
  const perRun = merchant ? Number(merchant.price) + fee : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* New subscription: a sentence, then the one action. */}
      <section aria-labelledby="sub-new" className="panel lg:col-span-5">
        <h3 id="sub-new" className="font-display text-lg font-semibold tracking-[-0.01em]">Schedule a payment</h3>
        <p className="mt-1 text-sm text-on-surface-variant">
          The agent signs every payment now as a Hedera Scheduled Transaction. The network pays at each time, then Chowkidaar makes the call. Failed calls are refunded as usual.
        </p>
        {choices.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-dashed border-rule px-4 py-6 text-center text-sm text-on-surface-variant">
            This agent can&apos;t pay any merchant yet. Allow one in the Merchants tab first.
          </p>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) subscribe.mutate(); }}>
            <label className="block">
              <span className="label">Merchant</span>
              <select className="input" value={slug} onChange={(e) => setF({ ...f, slug: e.target.value })}>
                {choices.map((m) => <option key={m.id} value={m.slug}>{m.name}, {usdc(m.price)} USDC a call</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Every</span>
                <select className="input" value={f.everySec} onChange={(e) => setF({ ...f, everySec: e.target.value })}>
                  {EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Runs</span>
                <input className="input money" type="number" min={1} max={8} value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} aria-invalid={!(times >= 1 && times <= 8) || undefined} />
              </label>
            </div>
            <label className="block">
              <span className="label">Request <span className="text-outline">(optional)</span></span>
              <input className="input" placeholder={merchant?.samplePrompt ?? "What to ask the merchant each time"} value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
            </label>
            <div className="well money flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
              <span className="text-on-surface-variant">{valid ? `${times} × ${usdc(perRun)} USDC, first ${until(now + every * 1000, now)}` : "Up to 8 runs, within 62 days"}</span>
              {valid && <span className="font-semibold">{formatUsdc(perRun * times)}</span>}
            </div>
            <button type="submit" className="btn-primary w-full" disabled={!valid || subscribe.isPending}>
              <Repeat className="h-4 w-4" aria-hidden /> {subscribe.isPending ? "Signing payments on Hedera…" : "Schedule payments"}
            </button>
            {subscribe.isError && <p role="alert" className="text-sm text-bad">{subError ?? "Couldn't schedule the payments. Check your connection and try again."}</p>}
          </form>
        )}
      </section>

      {/* Existing subscriptions, newest first, each with its runs as a timeline. */}
      <section aria-labelledby="sub-list" className="space-y-4 lg:col-span-7">
        <h3 id="sub-list" className="sr-only">Your scheduled payments</h3>
        {subs.isError && !subs.data ? <LoadError what="scheduled payments" retry={() => subs.refetch()} />
          : !subs.data ? <div className="skeleton h-48" />
          : subs.data.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">
              <CalendarClock className="h-5 w-5 text-outline" aria-hidden />
              <p>No scheduled payments yet. Each schedule shows up here with its runs and receipts.</p>
            </div>
          ) : subs.data.map((s) => {
            const pending = s.runs.filter((r) => r.status === "scheduled").length;
            const done = s.runs.filter((r) => r.status === "done").length;
            const active = s.status === "active" && pending > 0;
            return (
              <article key={s.id} className="panel" aria-label={`Scheduled payments to ${s.merchantName}`}>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[15px] font-semibold">{s.merchantName}</h4>
                      <span className={cx("pill", s.status === "cancelled" ? "pill-muted" : active ? "pill-ok" : "pill-muted")}>{s.status === "cancelled" ? "Cancelled" : active ? "Active" : "Finished"}</span>
                    </div>
                    <p className="money mt-0.5 text-sm text-on-surface-variant">
                      {usdc(s.amount)} USDC every {everyLabel(s.everySec)}, {done} of {s.runs.length} runs done
                    </p>
                  </div>
                  {s.status === "active" && pending > 0 && confirming !== s.id && (
                    <button type="button" className="btn-ghost" onClick={() => setConfirming(s.id)}>Cancel remaining</button>
                  )}
                </header>

                {confirming === s.id && (
                  <div role="group" aria-label="Confirm cancel" className="well mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                    <p className="min-w-0 flex-1 basis-60 text-sm">Cancel the {pending} remaining {pending === 1 ? "run" : "runs"}? Their scheduled payments are deleted on Hedera, so nothing more is paid.</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost" autoFocus disabled={cancel.isPending} onClick={() => setConfirming(null)}>Keep them</button>
                      <button type="button" className="btn-secondary border-bad/40 text-bad hover:border-bad hover:bg-bad-subtle" disabled={cancel.isPending} onClick={() => cancel.mutate(s.id)}>
                        {cancel.isPending ? "Cancelling…" : "Cancel runs"}
                      </button>
                    </div>
                  </div>
                )}
                {cancel.isError && cancel.variables === s.id && <p role="alert" className="mt-3 text-sm text-bad">Couldn&apos;t cancel the runs. Check your connection and try again.</p>}

                <ol className="mt-4">
                  {s.runs.map((r, i) => {
                    const icon = r.status === "done" ? <Check className="h-3.5 w-3.5" aria-label="Paid" /> : r.status === "failed" ? <X className="h-3.5 w-3.5" aria-label="Not executed" />
                      : r.status === "cancelled" ? <Minus className="h-3.5 w-3.5" aria-label="Cancelled" /> : <CalendarClock className="h-3 w-3" aria-label="Scheduled" />;
                    const tone = r.status === "done" ? "bg-ok-subtle text-ok" : r.status === "failed" ? "bg-bad-subtle text-bad" : r.status === "cancelled" ? "bg-surface-container text-outline" : "border border-rule-strong bg-surface-container-lowest text-on-surface-variant";
                    return (
                      <li key={r.scheduleId} className="relative flex gap-3 pb-3.5 last:pb-0">
                        {i < s.runs.length - 1 && <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-px bg-rule" />}
                        <span className={cx("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", tone)}>{icon}</span>
                        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <div className="min-w-0">
                            <div className="text-sm">
                              <span className="money text-on-surface-variant">Run {r.n}</span>{" "}
                              <span className="font-medium">
                                {r.status === "scheduled" ? (r.executeAt > now ? `Pays ${until(r.executeAt, now)}` : "Paying now") : r.status === "done" ? "Paid and called" : r.status === "failed" ? "Not executed" : "Cancelled"}
                              </span>
                            </div>
                            <div className="text-xs text-on-surface-variant">{when(r.executeAt)}{r.error ? `, ${r.error}` : ""}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {r.status === "done" && r.paymentId && (
                              <>
                                <StatusBadge status={r.paymentStatus ?? "calling"} />
                                <Link href={`/receipts/${r.paymentId}`} className="text-xs text-on-surface-variant underline decoration-outline underline-offset-4 hover:text-on-surface">Receipt</Link>
                              </>
                            )}
                            <a className="inline-flex min-h-8 items-center gap-1 font-mono text-xs text-on-surface-variant underline decoration-outline underline-offset-4 hover:text-on-surface"
                              href={`${HASHSCAN}/schedule/${r.scheduleId}`} target="_blank" rel="noreferrer">
                              {r.scheduleId} <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens HashScan)</span>
                            </a>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </article>
            );
          })}
      </section>
    </div>
  );
}
