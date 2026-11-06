"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Search } from "lucide-react";
import type { PublicMerchant, Receipt } from "@app/shared";
import { ApiError, HASHSCAN, get, isStepUp, patch, post, put, startStepUp, takePendingStepUp, type AgentRow, type Config } from "@/lib/api";
import { CopyButton, TxLink, cx, microFromInput, usdcInput } from "@/lib/ui";
import { reasonText } from "@/lib/world";
import { useWallet } from "@/components/WalletPanel";
import { McpSnippet } from "@/components/McpSnippet";
import { AgentId } from "@/components/AgentId";
import { ScheduledFunding } from "@/components/ScheduledFunding";
import { Subscriptions } from "@/components/Subscriptions";
import { Activity, LoadError, Meter, Note, PageHeader, Segmented, Switch, usdc } from "@/components/owner/kit";

const ERRORS: Record<string, string> = {
  daily_cap_below_per_call: "The daily limit must be at least the per-payment limit.",
  approval_above_per_call: "The approval amount can't be more than the per-payment limit.",
  validation_error: "Amounts must be positive numbers.",
};
const errorText = (code: string) => ERRORS[code] ?? "Your changes weren't saved. Check your connection and try again.";

const TABS = [["activity", "Activity"], ["limits", "Limits"], ["merchants", "Merchants"], ["schedules", "Schedules"], ["connect", "Connect"]] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: string | null): v is Tab => TABS.some(([k]) => k === v);

const DESTRUCTIVE = "btn-secondary border-bad text-bad hover:border-bad hover:bg-bad-subtle";

export default function AgentDetailPage() {
  return <Suspense><AgentDetail /></Suspense>;
}

function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const here = `/owner/agents/${id}`;
  const agent = useQuery({ queryKey: ["agent", id], queryFn: () => get<AgentRow>(`/api/agents/${id}`), refetchInterval: 8000 });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitsSaved, setLimitsSaved] = useState(false);
  useEffect(() => { if (!limitsSaved) return; const t = setTimeout(() => setLimitsSaved(false), 3000); return () => clearTimeout(t); }, [limitsSaved]);

  // The tab lives in the URL (?tab=), so it survives a reload and a World ID round trip.
  const stepup = params.get("stepup");
  const scope = params.get("scope") ?? "";
  const scopeTab: Tab | null = scope === `agent:${id}:limits` ? "limits" : scope === `agent:${id}:key` ? "connect" : null;
  const rawTab = params.get("tab");
  const urlTab = rawTab === "subscriptions" ? "schedules" : rawTab; // older links
  const tab: Tab = isTab(urlTab) ? urlTab : scopeTab ?? "activity";
  const setTab = (t: Tab) => router.replace(t === "activity" ? here : `${here}?tab=${t}`, { scroll: false });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["agent", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); };
  // Loosening a limit answers step_up_required: verify with World ID, come back, and finish the save.
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<AgentRow>(`/api/agents/${id}`, body),
    onSuccess: (row, body) => {
      if (row && typeof row === "object" && "id" in row) qc.setQueryData<AgentRow>(["agent", id], (old) => (old ? { ...old, ...row } : row));
      invalidate(); setError(null);
      if ("perCallCap" in body) setLimitsSaved(true);
    },
    onError: (e, body) => isStepUp(e) ? startStepUp(e.body.scope, here, { kind: "limits", body }) : setError(e instanceof ApiError ? errorText(e.code) : errorText("")),
  });
  const rotate = useMutation({
    mutationFn: () => post<AgentRow>(`/api/agents/${id}/rotate-key`),
    onSuccess: (a) => { setNewKey(a.apiKey ?? null); setError(null); invalidate(); },
    onError: (e) => isStepUp(e) ? startStepUp(e.body.scope, here, { kind: "key" }) : setError("Couldn't replace the key. Check your connection and try again."),
  });

  // Back from a step-up: finish what the owner asked for (once), or explain why it did not happen.
  useEffect(() => {
    if (stepup !== "ok") return;
    window.history.replaceState(null, "", scopeTab ? `${here}?tab=${scopeTab}` : here);
    if (scope === `agent:${id}:limits`) { const p = takePendingStepUp<{ body: Record<string, unknown> }>(scope); if (p) update.mutate(p.body); }
    if (scope === `agent:${id}:key`) { if (takePendingStepUp(scope)) rotate.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepup, scope]);

  if (agent.isError && !agent.data) {
    const missing = agent.error instanceof ApiError && (agent.error.status === 404 || agent.error.status === 403);
    return missing ? (
      <PageHeader title="Agent not found" sub="This agent doesn't exist or isn't yours." actions={<Link href="/owner" className="btn-secondary">Back to overview</Link>} />
    ) : (
      <div><PageHeader title="Agent" /><LoadError what="this agent" retry={() => agent.refetch()} /></div>
    );
  }
  if (!agent.data) {
    return (
      <div aria-busy="true" aria-label="Loading agent">
        <div className="space-y-3 pb-8"><div className="skeleton h-9 w-56" /><div className="skeleton h-4 w-32" /></div>
        <div className="skeleton h-40 rounded-[24px]" />
        <div className="skeleton mt-8 h-10 w-80 max-w-full" />
        <div className="skeleton mt-6 h-48" />
      </div>
    );
  }
  const a = agent.data;
  const paused = a.status === "paused";
  const vars = update.isPending ? update.variables : undefined;
  const switching = vars && "status" in vars ? vars.status : null;
  const savingLimits = Boolean(vars && "perCallCap" in vars);

  return (
    <div>
      <PageHeader
        title={a.name}
        sub={
          <span className="flex flex-col gap-1.5">
            <a className="w-fit font-mono text-xs hover:text-on-surface hover:underline" href={`${HASHSCAN}/account/${a.hederaAccountId}`} target="_blank" rel="noreferrer">{a.hederaAccountId}</a>
            {a.uaid && <AgentId uaid={a.uaid} seq={a.uaidSeq} />}
          </span>
        }
        actions={
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <span className={cx("min-w-[5.5rem] text-right", paused && !switching ? "text-on-surface-variant" : "font-medium")} aria-live="polite">
              {switching === "paused" ? "Pausing…" : switching === "active" ? "Resuming…" : paused ? "Paused" : "Active"}
            </span>
            <Switch checked={!paused} label="Agent can pay" disabled={update.isPending} onChange={(on) => update.mutate({ status: on ? "active" : "paused" })} />
          </label>
        }
      />

      {paused && <div className="mb-6"><Note tone="amber">This agent is paused. Every payment it tries is blocked until you turn it back on.</Note></div>}
      {stepup === "denied" && <div className="mb-6"><Note tone="red">{reasonText(params.get("reason"))} Your change wasn&apos;t saved.</Note></div>}
      {error && <div className="mb-6"><Note tone="red">{error}</Note></div>}

      <Summary a={a} />

      <Tabs tab={tab} setTab={setTab} />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="pt-6 focus-visible:-outline-offset-2">
        {tab === "activity" && <ActivityTab id={id} />}
        {tab === "limits" && <LimitsTab a={a} saving={savingLimits} saved={limitsSaved} save={(b) => { setLimitsSaved(false); update.mutate(b); }} />}
        {tab === "merchants" && <MerchantsTab a={a} toggleAllowlist={(v) => update.mutate({ allowlistOnly: v })} togglingAllowlist={Boolean(vars && "allowlistOnly" in vars)} onChange={invalidate} />}
        {tab === "schedules" && (a.custodial
          ? <SchedulesTab a={a} />
          : <p className="rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">Schedules need a wallet we hold for the agent, because the agent signs every scheduled payment up front.</p>)}
        {tab === "connect" && <ConnectTab a={a} newKey={newKey} rotating={rotate.isPending} rotate={() => rotate.mutate()} />}
      </div>
    </div>
  );
}

/** Tabs with a roving tabindex: Tab enters once, arrows (and Home/End) move between them. */
function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = TABS.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const k = TABS[next][0];
    setTab(k);
    refs.current[k]?.focus();
  };
  return (
    <div role="tablist" aria-label="Agent sections" className="mt-8 flex gap-6 overflow-x-auto border-b border-rule">
      {TABS.map(([k, label], i) => (
        <button key={k} ref={(el) => { refs.current[k] = el; }} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`}
          tabIndex={tab === k ? 0 : -1} onClick={() => setTab(k)} onKeyDown={(e) => onKey(e, i)}
          className={cx("-mb-px min-h-10 shrink-0 border-b-2 pb-2.5 pt-2 text-sm transition-colors focus-visible:-outline-offset-2",
            tab === k ? "border-primary font-medium text-on-surface" : "border-transparent text-on-surface-variant hover:text-on-surface")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Balance and today's budget side by side: the two numbers an owner checks first. */
function Summary({ a }: { a: AgentRow }) {
  const qc = useQueryClient();
  const w = useWallet(a.hederaAccountId);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const [funded, setFunded] = useState<string | null>(null);
  useEffect(() => { if (!funded) return; const t = setTimeout(() => setFunded(null), 4000); return () => clearTimeout(t); }, [funded]);
  const fund = useMutation({
    mutationFn: () => post<{ amount?: number; txId: string }>(`/api/agents/${a.id}/fund`),
    onSuccess: (r) => { setFunded(r.txId ?? ""); setTimeout(() => qc.invalidateQueries({ queryKey: ["wallet", a.hederaAccountId] }), 4000); },
  });
  const canFund = a.custodial && cfg.data?.features.demoMode;
  const low = w.isSuccess && w.data.usdcMicro < a.perCallCap;

  return (
    <div className="grid overflow-hidden rounded-[24px] bg-surface-container-lowest sm:grid-cols-2">
      <div className="p-5 sm:p-6">
        <div className="flex items-baseline gap-1.5">
          {w.isSuccess ? <span className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{usdc(w.data.usdcMicro)}</span>
            : w.isError ? <span className="font-display text-2xl font-semibold leading-tight text-on-surface-variant">Unavailable</span>
            : <span className="skeleton inline-block h-10 w-28" />}
          {w.isSuccess && <span className="text-sm text-on-surface-variant">USDC</span>}
        </div>
        <div className="mt-2 text-sm text-on-surface-variant">Wallet balance</div>
        <div className="mt-4 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {w.isError && (
            <>
              <span className="text-on-surface-variant">Couldn&apos;t read the balance from Hedera.</span>
              <button type="button" className="btn-ghost" onClick={() => w.refetch()}>Try again</button>
            </>
          )}
          {low && <span className="text-warn">Too low for a full-price payment.</span>}
          {canFund && (funded !== null ? (
            <span role="status" className="inline-flex flex-wrap items-center gap-x-2 text-on-surface">
              Added 0.5 test USDC.{funded && <TxLink id={funded} label="View on HashScan" />}
            </span>
          ) : (
            <button type="button" className="btn-secondary" disabled={fund.isPending} onClick={() => fund.mutate()}>
              {fund.isPending ? "Adding…" : "Add 0.5 test USDC"}
            </button>
          ))}
          {fund.isError && funded === null && <span role="alert" className="text-bad">Couldn&apos;t add test USDC. Check your connection and try again.</span>}
          {!canFund && !w.isError && <span className="text-on-surface-variant">Send USDC to <span className="font-mono text-xs">{a.hederaAccountId}</span> to top up.</span>}
        </div>
      </div>
      <div className="border-t border-rule p-5 sm:border-l sm:border-t-0 sm:p-6">
        <div className="flex items-baseline gap-1.5">
          <span className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{usdc(a.spentToday)}</span>
          <span className="money text-sm text-on-surface-variant">of {usdc(a.dailyCap)}&nbsp;USDC</span>
        </div>
        <div className="mt-2 text-sm text-on-surface-variant">Spent today</div>
        <Meter used={a.spentToday} cap={a.dailyCap} className="mt-5" />
        <p className="mt-2 text-xs text-outline">Resets at midnight UTC.</p>
      </div>
    </div>
  );
}

const FILTERS = [["all", "All"], ["delivered", "Delivered"], ["refunded", "Refunded"]] as const;
type Filter = (typeof FILTERS)[number][0];

function ActivityTab({ id }: { id: string }) {
  const payments = useQuery({ queryKey: ["agent-payments", id], queryFn: () => get<Receipt[]>(`/api/agents/${id}/payments`), refetchInterval: 4000 });
  const [filter, setFilter] = useState<Filter>("all");
  if (payments.isError && !payments.data) return <LoadError what="this agent's payments" retry={() => payments.refetch()} />;
  const rows = payments.data?.filter((p) => filter === "all" || (filter === "delivered" ? p.status === "delivered" : p.status.startsWith("refund")));
  return (
    <div className="space-y-3">
      <Segmented label="Show payments" value={filter} onChange={setFilter} options={FILTERS} />
      <Activity rows={rows} empty={filter === "all" ? (
        <div className="flex flex-col items-center gap-3">
          <p>No payments yet. Ask this agent for something in the console.</p>
          <Link href="/console" className="btn-secondary">Open console</Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p>No {filter} payments yet.</p>
          <button type="button" className="btn-secondary" onClick={() => setFilter("all")}>Show all</button>
        </div>
      )} />
    </div>
  );
}

const LIMITS = [
  ["perCallCap", "Per payment", "The most it can spend on a single call.", "USDC"],
  ["dailyCap", "Per day", "Resets at midnight UTC.", "USDC"],
  ["approvalThreshold", "Ask me above", "Bigger payments wait for your approval.", "USDC"],
  ["minScore", "Minimum merchant score", "Out of 100. New merchants with under 5 calls are allowed.", ""],
] as const;
type LimitKey = (typeof LIMITS)[number][0];
type Limits = Record<LimitKey, number>;
type Form = Record<LimitKey, string>;
const KEYS = LIMITS.map(([k]) => k);

const limitsOf = (a: AgentRow): Limits => ({ perCallCap: a.perCallCap, dailyCap: a.dailyCap, approvalThreshold: a.approvalThreshold, minScore: a.minScore });
const toForm = (l: Limits): Form => ({ perCallCap: usdcInput(l.perCallCap), dailyCap: usdcInput(l.dailyCap), approvalThreshold: usdcInput(l.approvalThreshold), minScore: String(l.minScore) });
/** The form value in the server's units (micro-USDC, or a whole score). NaN when it doesn't parse. */
const parse = (k: LimitKey, v: string) => {
  if (k === "minScore") return /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  try { return microFromInput(v); } catch { return NaN; }
};
const parsed = (f: Form) => Object.fromEntries(KEYS.map((k) => [k, parse(k, f[k])])) as Limits;
const same = (x: Limits, y: Limits) => KEYS.every((k) => x[k] === y[k]);

function validate(f: Form): Partial<Record<LimitKey, string>> {
  const p = parsed(f);
  const e: Partial<Record<LimitKey, string>> = {};
  const amount = "Enter an amount above 0 USDC, with up to 6 decimals.";
  if (Number.isNaN(p.perCallCap) || p.perCallCap <= 0) e.perCallCap = amount;
  if (Number.isNaN(p.dailyCap) || p.dailyCap <= 0) e.dailyCap = amount;
  else if (!e.perCallCap && p.dailyCap < p.perCallCap) e.dailyCap = "Must be at least the per-payment limit.";
  if (Number.isNaN(p.approvalThreshold)) e.approvalThreshold = "Enter an amount in USDC, with up to 6 decimals.";
  else if (!e.perCallCap && p.approvalThreshold > p.perCallCap) e.approvalThreshold = "Can't be more than the per-payment limit.";
  if (Number.isNaN(p.minScore) || p.minScore < 0 || p.minScore > 100) e.minScore = "Enter a whole number from 0 to 100.";
  return e;
}

function LimitsTab({ a, saving, saved, save }: { a: AgentRow; saving: boolean; saved: boolean; save: (b: Limits) => void }) {
  const server = limitsOf(a);
  const [f, setF] = useState<Form>(() => toForm(server));
  const [touched, setTouched] = useState<Set<LimitKey>>(new Set());
  const prev = useRef(server);
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants") });

  // When the saved values change (after a save, or elsewhere), follow them unless the owner is mid-edit.
  const serverKey = KEYS.map((k) => server[k]).join(",");
  useEffect(() => {
    const old = prev.current;
    prev.current = server;
    setF((cur) => { const p = parsed(cur); return same(p, old) || same(p, server) ? toForm(server) : cur; });
    if (same(parsed(f), server)) setTouched(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  const errors = validate(f);
  const p = parsed(f);
  const dirty = !same(p, server);
  const shown = (k: LimitKey) => (touched.has(k) ? errors[k] : undefined);
  const ok = (k: LimitKey) => !Number.isNaN(p[k]) && !errors[k];

  // What each limit means against the merchants this agent can actually pay.
  const pool = (merchants.data ?? []).filter((m) => !a.allowlistOnly || a.allowedMerchantIds.includes(m.id));
  const prices = pool.map((m) => Number(m.price)).filter((n) => n > 0);
  const cheapest = prices.length ? Math.min(...prices) : null;
  const qualifies = (m: PublicMerchant) => m.totalCalls < 5 || (m.score ?? 0) >= p.minScore;
  const effect: Record<LimitKey, string | null> = {
    perCallCap: !ok("perCallCap") || !pool.length ? null
      : `${pool.filter((m) => Number(m.price) <= p.perCallCap).length} of ${pool.length} merchants fit under it.`,
    dailyCap: !ok("dailyCap") || cheapest == null ? null
      : `About ${Math.floor(p.dailyCap / cheapest).toLocaleString()} calls a day at the cheapest merchant.`,
    approvalThreshold: !ok("approvalThreshold") || !pool.length ? null
      : (() => { const n = pool.filter((m) => Number(m.price) > p.approvalThreshold && Number(m.price) <= p.perCallCap).length; return n ? `${n} merchant${n === 1 ? "" : "s"} will wait for your approval.` : "Every merchant it can pay goes through without asking."; })(),
    minScore: !ok("minScore") || !pool.length ? null : `${pool.filter(qualifies).length} of ${pool.length} merchants qualify today.`,
  };
  const changed = KEYS.filter((k) => p[k] !== server[k]).length;
  const reset = () => { setF(toForm(server)); setTouched(new Set()); };

  return (
    <form noValidate className="grid gap-5 lg:grid-cols-12" onSubmit={(e) => {
      e.preventDefault();
      setTouched(new Set(KEYS));
      const bad = KEYS.find((k) => errors[k]);
      if (bad) { document.getElementById(`limit-${bad}`)?.focus(); return; }
      save(p);
    }}>
      <section aria-labelledby="limits-title" className="panel lg:col-span-8">
        <h2 id="limits-title" className="font-display text-xl font-semibold tracking-[-0.01em]">Spending limits</h2>
        <p className="mt-1 text-sm text-on-surface-variant">Checked by the gateway before any money moves. Tightening applies at once; loosening asks you to confirm with World ID.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {LIMITS.map(([k, label, hint, unit]) => {
            const err = shown(k);
            const changed = !Number.isNaN(p[k]) && p[k] !== server[k];
            return (
              <div key={k} className={cx("well flex flex-col p-4 transition-colors", err ? "ring-1 ring-inset ring-bad/60" : changed && "ring-1 ring-inset ring-primary/40")}>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`limit-${k}`} className="text-sm font-medium">{label}</label>
                  {changed && !err && <span className="text-xs text-on-surface-variant">was <span className="money">{k === "minScore" ? server[k] : usdc(server[k])}</span></span>}
                </div>
                <p id={`limit-${k}-hint`} className="mt-0.5 text-xs text-on-surface-variant">{hint}</p>
                <div className="relative mt-3">
                  <input id={`limit-${k}`} className={cx("input money h-12 font-display text-2xl font-semibold tracking-[-0.01em]", unit ? "pr-16" : "pr-14")}
                    inputMode={k === "minScore" ? "numeric" : "decimal"} value={f[k]} aria-invalid={err ? true : undefined}
                    aria-describedby={cx(`limit-${k}-hint`, err ? `limit-${k}-error` : `limit-${k}-effect`)}
                    onChange={(e) => setF({ ...f, [k]: e.target.value })}
                    onBlur={() => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))} />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-outline">{unit || "/ 100"}</span>
                </div>
                <p id={err ? `limit-${k}-error` : `limit-${k}-effect`} className={cx("mt-2 min-h-[1lh] text-xs", err ? "text-bad" : "text-on-surface-variant")}>
                  {err ?? effect[k] ?? " "}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="space-y-5 lg:col-span-4">
        <DecisionScale p={p} valid={!errors.perCallCap && !errors.approvalThreshold} pool={pool} />
        <section aria-labelledby="today-title" className="panel">
          <h2 id="today-title" className="text-sm font-medium">Today</h2>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="money font-display text-2xl font-semibold">{usdc(a.spentToday)}</span>
            <span className="money text-sm text-on-surface-variant">of {usdc(ok("dailyCap") ? p.dailyCap : server.dailyCap)} USDC spent</span>
          </div>
          <Meter used={a.spentToday} cap={ok("dailyCap") ? p.dailyCap : server.dailyCap} className="mt-3" />
          <p className="mt-2 text-xs text-outline">The daily budget resets at midnight UTC.</p>
        </section>
      </aside>

      {/* Save bar: only when something changed, pinned to the bottom of the viewport so it's never out of reach. */}
      <div className={cx("sticky bottom-4 z-30 lg:col-span-12", !dirty && !saved && "hidden")}>
        <div className="flex flex-wrap items-center gap-3 rounded-full border border-rule-strong bg-surface-container-lowest/95 py-2 pl-5 pr-2 shadow-[0_12px_32px_-12px_rgb(16_16_20/0.22)] backdrop-blur">
          <span role="status" className="mr-auto text-sm">
            {dirty ? <>Unsaved changes <span className="text-on-surface-variant">to {changed} {changed === 1 ? "limit" : "limits"}</span></> : <span className="text-ok">Limits saved</span>}
          </span>
          {dirty && !saving && <button type="button" className="btn-ghost" onClick={reset}>Discard</button>}
          {dirty && <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save limits"}</button>}
        </div>
      </div>
    </form>
  );
}

/** One horizontal scale of price: paid automatically, waits for you, blocked. Follows the form as you type. */
function DecisionScale({ p, valid, pool }: { p: Limits; valid: boolean; pool: PublicMerchant[] }) {
  const cap = p.perCallCap, ask = Math.min(p.approvalThreshold, cap);
  const top = Math.max(cap * 1.25, ...pool.map((m) => Number(m.price)), 1);
  const at = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  const zone = (price: number) => (price > cap ? "bad" : price > ask ? "warn" : "ok");
  return (
    <section aria-labelledby="scale-title" className="panel">
      <h2 id="scale-title" className="text-sm font-medium">How a payment is decided</h2>
      {!valid ? <p className="mt-3 text-sm text-on-surface-variant">Fix the limits to see the preview.</p> : (
        <>
          <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-surface-container-high" aria-hidden>
            <div className="absolute inset-y-0 left-0 bg-ok/80" style={{ width: at(ask) }} />
            <div className="absolute inset-y-0 bg-warn/80" style={{ left: at(ask), width: `calc(${at(cap)} - ${at(ask)})` }} />
            <div className="absolute inset-y-0 right-0 bg-bad/45" style={{ left: at(cap) }} />
          </div>
          <div className="relative mt-1 h-4 text-[12px] text-outline" aria-hidden>
            {ask > 0 && <span className="money absolute -translate-x-1/2" style={{ left: at(ask) }}>{usdc(ask)}</span>}
            <span className="money absolute -translate-x-1/2" style={{ left: at(cap) }}>{usdc(cap)}</span>
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            {([["ok", "Paid automatically", ask > 0 ? `Up to ${usdc(ask)} USDC` : "Nothing; every payment asks first"],
              ["warn", "Waits for your approval", ask < cap ? `${usdc(ask)} to ${usdc(cap)} USDC` : "Nothing in this range"],
              ["bad", "Blocked", `Above ${usdc(cap)} USDC`]] as const).map(([t, k, v]) => (
              <div key={k} className="flex items-start gap-3">
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", t === "ok" ? "bg-ok" : t === "warn" ? "bg-warn" : "bg-bad")} aria-hidden />
                <dt className="flex-1">{k}</dt>
                <dd className="money text-right text-on-surface-variant">{v}</dd>
              </div>
            ))}
          </dl>
          {pool.length > 0 && (
            <p className="mt-4 border-t border-rule pt-3 text-xs text-on-surface-variant">
              {(["ok", "warn", "bad"] as const).map((t) => [t, pool.filter((m) => zone(Number(m.price)) === t).length] as const)
                .filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t === "ok" ? "paid automatically" : t === "warn" ? "need approval" : "blocked"}`).join(", ")} among the merchants it can pay.
            </p>
          )}
        </>
      )}
    </section>
  );
}

type MerchantFilter = "all" | "allowed" | "off";

function MerchantsTab({ a, toggleAllowlist, togglingAllowlist, onChange }: { a: AgentRow; toggleAllowlist: (v: boolean) => void; togglingAllowlist: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const key = ["agent", a.id];
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants") });
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<MerchantFilter>("all");
  const [term, setTerm] = useState("");
  // Optimistic: the switch moves at once; requests for this agent run one after another so the last click wins.
  // Every save sends the merchant list AND the per-merchant limits: the server rebuilds the rows, so a
  // save without limits would wipe them. Optimistic: switches move at once, saves run in order.
  type Allow = { merchantIds: string[]; dailyCaps: Record<string, number | null> };
  const capsOf = (row?: AgentRow) => Object.fromEntries(Object.entries((row ?? a).merchantCaps ?? {}).map(([k, v]) => [k, v.dailyCap])) as Record<string, number | null>;
  const allow = useMutation({
    mutationKey: ["allowlist", a.id],
    scope: { id: `allowlist:${a.id}` },
    mutationFn: (body: Allow) => put(`/api/agents/${a.id}/allowlist`, body),
    onMutate: async ({ merchantIds, dailyCaps }) => {
      setFailed(false);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AgentRow>(key);
      qc.setQueryData<AgentRow>(key, (o) => {
        if (!o) return o;
        const merchantCaps: AgentRow["merchantCaps"] = {};
        for (const id of merchantIds) if (dailyCaps[id] != null) merchantCaps[id] = { dailyCap: dailyCaps[id]!, spentToday: o.merchantCaps?.[id]?.spentToday ?? 0 };
        return { ...o, allowedMerchantIds: merchantIds, merchantCaps };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); setFailed(true); },
    onSettled: () => { if (qc.isMutating({ mutationKey: ["allowlist", a.id] }) <= 1) onChange(); },
  });
  const allowed = new Set(a.allowedMerchantIds);
  const latest = () => qc.getQueryData<AgentRow>(key) ?? a;
  const save = (ids: Iterable<string>, caps: Record<string, number | null> = capsOf(latest())) => allow.mutate({ merchantIds: [...ids], dailyCaps: caps });
  const set = (id: string, on: boolean) => { const next = new Set(latest().allowedMerchantIds); if (on) next.add(id); else next.delete(id); save(next); };
  const setCap = (id: string, micro: number | null) => save(latest().allowedMerchantIds, { ...capsOf(latest()), [id]: micro });

  const all = merchants.data ?? [];
  const needle = term.trim().toLowerCase();
  const shown = all.filter((m) =>
    (filter === "all" || (filter === "allowed") === allowed.has(m.id)) &&
    (!needle || [m.name, m.slug, m.category, m.description ?? "", ...m.keywords].some((x) => x.toLowerCase().includes(needle))));
  const allowedCount = all.filter((m) => allowed.has(m.id)).length;
  const editing = a.allowlistOnly;

  // Why this agent's own limits would still stop it from paying a merchant it allows.
  const blocker = (m: PublicMerchant) =>
    Number(m.price) > a.perCallCap ? "Over this agent's per-payment limit"
      : m.totalCalls >= 5 && (m.score ?? 0) < a.minScore ? "Below your minimum score"
      : !m.covered ? "No bond, so refunds aren't guaranteed" : null;
  const asks = (m: PublicMerchant) => Number(m.price) > a.approvalThreshold && Number(m.price) <= a.perCallCap;

  return (
    <div className="space-y-5">
      <section className="panel space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <Switch checked={a.allowlistOnly} label="Only pay merchants I pick" disabled={togglingAllowlist} onChange={toggleAllowlist} />
            <div className="min-w-0">
              <div className="text-sm font-medium">Only pay merchants I pick</div>
              <div className="text-xs text-on-surface-variant">
                {editing ? <><span className="money">{allowedCount}</span> of <span className="money">{all.length}</span> merchants allowed.</> : "Off: this agent can pay any live merchant that has a bond."}
              </div>
            </div>
          </div>
          {editing && all.length > 0 && (
            <div className="flex gap-1">
              <button type="button" className="btn-ghost" disabled={allowedCount === all.length} onClick={() => save(all.map((m) => m.id))}>Allow all</button>
              <button type="button" className="btn-ghost" disabled={allowedCount === 0} onClick={() => save([])}>Clear</button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Segmented label="Show merchants" value={filter} onChange={setFilter}
            options={[["all", `All ${all.length || ""}`.trim()], ["allowed", `Allowed ${allowedCount}`], ["off", `Not allowed ${all.length - allowedCount}`]]} />
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search merchants</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden />
            <input className="input rounded-full pl-10" placeholder="Search by name or what it does" value={term} onChange={(e) => setTerm(e.target.value)} />
          </label>
        </div>
      </section>

      {failed && <Note tone="red">Couldn&apos;t update the merchant list, so it&apos;s back to what was saved. Check your connection and try again.</Note>}

      {merchants.isError && !merchants.data ? <LoadError what="merchants" retry={() => merchants.refetch()} />
        : !merchants.data ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-40" />)}</div>
        : all.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">
            <p>No merchants are live yet, so there&apos;s nothing to pick.</p>
            <Link href="/merchants" className="btn-secondary">Browse merchants</Link>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">
            <p>{needle ? <>No merchant matches &ldquo;{term.trim()}&rdquo;.</> : filter === "allowed" ? "No merchants allowed yet." : "Every merchant is allowed."}</p>
            <button type="button" className="btn-secondary" onClick={() => { setFilter("all"); setTerm(""); }}>Show all merchants</button>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => {
              const on = allowed.has(m.id);
              const why = blocker(m);
              return (
                <li key={m.id} className={cx("panel flex h-full flex-col p-0 transition-colors", editing && on && "ring-1 ring-inset ring-primary/45", !editing && "opacity-60")}>
                  {/* The top of the card toggles the merchant; the limit row below is its own control. */}
                  <label className={cx("flex flex-1 flex-col gap-3 rounded-t-[24px] p-4 sm:p-5", editing ? "cursor-pointer hover:bg-surface-container-low" : "cursor-not-allowed")}>
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-display text-base font-semibold">{m.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{m.name}</div>
                        <div className="text-xs text-on-surface-variant">{m.category}</div>
                      </div>
                      <Switch checked={on} label={`Allow ${m.name}`} disabled={!editing} onChange={(v) => set(m.id, v)} />
                    </div>
                    {m.description && <p className="line-clamp-2 text-sm text-on-surface-variant">{m.description}</p>}
                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3 text-xs">
                      <span><span className="money text-sm font-medium text-on-surface">{usdc(m.price)}</span> <span className="text-on-surface-variant">USDC a call</span></span>
                      <span className="text-on-surface-variant">{m.totalCalls < 5 ? "New merchant" : <>Score <span className="money text-on-surface">{m.score}</span></>}</span>
                      {why ? <span className="pill pill-warn ml-auto">{why}</span> : asks(m) ? <span className="pill pill-muted ml-auto">Asks you first</span> : null}
                    </div>
                  </label>
                  {on && <MerchantLimit name={m.name} cap={a.merchantCaps?.[m.id]} price={Number(m.price)} onSave={(micro) => setCap(m.id, micro)} />}
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

/**
 * A per-merchant daily limit: the most this one merchant may take from the agent per UTC day,
 * enforced on top of the agent-wide limits. Saved when the field loses focus or on Enter.
 */
function MerchantLimit({ name, cap, price, onSave }: { name: string; cap?: { dailyCap: number; spentToday: number }; price: number; onSave: (micro: number | null) => void }) {
  const saved = cap ? usdcInput(cap.dailyCap) : "";
  const [v, setV] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV(saved); }, [saved]);
  const commit = () => {
    const raw = v.trim();
    if (raw === saved) { setErr(null); return; }
    if (!raw) { setErr(null); onSave(null); return; }
    let micro: number;
    try { micro = microFromInput(raw); } catch { setErr("Enter an amount in USDC, with up to 6 decimals."); return; }
    if (micro <= 0) { setErr("Enter an amount above 0, or leave it empty for no limit."); return; }
    setErr(null);
    onSave(micro);
  };
  const id = `cap-${name.replace(/\W+/g, "-")}`;
  return (
    <div className="space-y-2 border-t border-rule px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs text-on-surface-variant">Daily limit for {name}</label>
        <span className="relative w-32 shrink-0">
          <input id={id} className="input money h-9 py-1 pr-12 text-right" inputMode="decimal" placeholder="None" value={v}
            aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : undefined}
            onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-outline">USDC</span>
        </span>
      </div>
      {err ? <p id={`${id}-err`} className="text-xs text-bad">{err}</p>
        : cap ? (
          <div className="space-y-1.5">
            <Meter used={cap.spentToday} cap={cap.dailyCap} />
            <p className="money text-xs text-on-surface-variant">
              {usdc(cap.spentToday)} of {usdc(cap.dailyCap)} used today{price > 0 ? `, about ${Math.max(0, Math.floor((cap.dailyCap - cap.spentToday) / (price * 1.02)))} more calls` : ""}
            </p>
          </div>
        ) : <p className="text-xs text-outline">No limit: only this agent&apos;s overall limits apply.</p>}
    </div>
  );
}

/** Everything that runs on a timer: scheduled payments to merchants, then scheduled top-ups of the wallet. */
function SchedulesTab({ a }: { a: AgentRow }) {
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants") });
  return (
    <div className="space-y-10">
      <div>
        <div className="mb-4 max-w-[62ch]">
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Scheduled payments</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Pay a merchant on a schedule. Each run is a protected call, so a failed one is refunded like any other.</p>
        </div>
        {merchants.isError && !merchants.data ? <LoadError what="merchants" retry={() => merchants.refetch()} />
          : !merchants.data ? <div className="skeleton h-64" />
          : <Subscriptions agent={a} merchants={merchants.data} />}
      </div>
      <ScheduledFunding agentId={a.id} scheduled={a.scheduledFunding ?? []} />
    </div>
  );
}

function ConnectTab({ a, newKey, rotating, rotate }: { a: AgentRow; newKey: string | null; rotating: boolean; rotate: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const well = useRef<HTMLDivElement>(null);
  useEffect(() => { if (newKey) { setConfirming(false); well.current?.focus(); } }, [newKey]);
  const cancel = () => { setConfirming(false); requestAnimationFrame(() => trigger.current?.focus()); };

  return (
    <div className="space-y-5">
      <section aria-labelledby="key-title" className="panel space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-[52ch]">
            <h2 id="key-title" className="font-display text-xl font-semibold tracking-[-0.01em]">API key</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Your agent sends this key with every call. It was shown once, when you created the agent.</p>
          </div>
          {!confirming && (
            <button ref={trigger} type="button" className="btn-secondary" aria-expanded={false} onClick={() => setConfirming(true)}>
              <KeyRound className="h-4 w-4" aria-hidden /> Replace key
            </button>
          )}
        </div>
        {!newKey && (
          <div className="well flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <KeyRound className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden />
            <code className="min-w-0 flex-1 truncate font-mono text-sm tracking-wider text-on-surface-variant" aria-label="API key, hidden">apk_••••••••••••••••••••••••••••</code>
            <span className="pill pill-ok">Active</span>
          </div>
        )}
        {confirming && (
          <div role="group" aria-labelledby="rotate-warning" className="well flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <p id="rotate-warning" className="min-w-0 flex-1 basis-64 text-sm">The current key stops working immediately. Agents using it will fail until you update them.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" autoFocus disabled={rotating} onClick={cancel}>Keep current key</button>
              <button type="button" className={DESTRUCTIVE} disabled={rotating} onClick={rotate}>{rotating ? "Replacing…" : "Replace key"}</button>
            </div>
          </div>
        )}
        {newKey && (
          <div className="space-y-2">
            <Note tone="amber">Copy this key now. You won&apos;t see it again. The setup below already includes it.</Note>
            <div ref={well} tabIndex={-1} aria-label="New API key" className="well flex items-center gap-2 py-1.5 pl-4 pr-1.5 focus-visible:-outline-offset-2">
              <code className="flex-1 break-all font-mono text-sm">{newKey}</code><CopyButton text={newKey} label="Copy API key" />
            </div>
          </div>
        )}
      </section>
      {a.custodial && <McpSnippet apiKey={newKey ?? undefined} />}
    </div>
  );
}
