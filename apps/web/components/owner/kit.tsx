"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { formatUsdc, REASON_LABEL, type Receipt } from "@app/shared";
import { ApiError, get, post, type ApprovalRow } from "@/lib/api";
import { cx } from "@/lib/ui";

/** "2 min ago", "Yesterday", "3 Nov": how people read recent activity. */
export function ago(t: number | null | undefined) {
  if (!t) return "Never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** USDC without the unit, for dense numeric columns where the unit is in the header. */
export const usdc = (micro: string | number | null | undefined) => formatUsdc(micro).replace(/ USDC$/, "");

/** Today's spend against the daily cap. Turns amber past 80%, red at the cap. */
export function Meter({ used, cap, className }: { used: number; cap: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const tone = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-secondary";
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-surface-container-high", className)} role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Daily budget used">
      <div className={cx("h-full w-full origin-left rounded-full transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)]", tone)} style={{ transform: `scaleX(${Math.max(pct, used > 0 ? 2 : 0) / 100})` }} />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 after:absolute after:-inset-x-1 after:-inset-y-2.5 disabled:cursor-not-allowed disabled:opacity-55",
        checked ? "bg-primary" : "bg-surface-container-highest")}>
      <span className={cx("inline-block h-5 w-5 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]", checked ? "translate-x-[22px] bg-on-primary" : "translate-x-0.5 bg-on-surface")} />
    </button>
  );
}

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-8">
      <div className="min-w-0">
        <h1 className="text-balance font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">{title}</h1>
        {sub && <div className="mt-2 max-w-[65ch] text-pretty text-[15px] text-on-surface-variant">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block on a page. Plain heading and a hairline, no card chrome unless the content needs a surface. */
export function Section({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("py-6 first:pt-0", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const DOT: Record<string, string> = { calling: "bg-info", delivered: "bg-ok", refund_pending: "bg-warn", refunded: "bg-info", refund_failed: "bg-bad" };
const WORD: Record<string, string> = { calling: "In progress", delivered: "Delivered", refund_pending: "Refunding", refunded: "Refunded", refund_failed: "Refund failed" };

/** One line per payment: what was bought, from whom, what it cost, and whether it worked. */
export function Activity({ rows, showAgent, empty }: { rows: Receipt[] | undefined; showAgent?: boolean; empty: React.ReactNode }) {
  if (!rows) return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12" />)}</div>;
  if (rows.length === 0) return <div className="rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">{empty}</div>;
  return (
    <ul className="divide-y divide-rule overflow-hidden rounded-[24px] bg-surface-container-lowest">
      {rows.map((p) => {
        const refunded = Number(p.money.refunded) > 0;
        return (
          <li key={p.paymentId}>
            <Link href={`/receipts/${p.paymentId}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3 transition-colors hover:bg-surface-container-low focus-visible:bg-surface-container-low focus-visible:-outline-offset-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cx("h-2 w-2 shrink-0 rounded-full", DOT[p.status] ?? "bg-outline")} aria-hidden />
                  <span className="truncate text-sm font-medium">{p.merchant.name}</span>
                  {showAgent && <span className="hidden truncate text-sm text-on-surface-variant sm:inline">for {p.agentName}</span>}
                </div>
                <div className="mt-0.5 pl-4 text-xs text-on-surface-variant">
                  {WORD[p.status] ?? p.status}{p.reason && p.status !== "delivered" ? `: ${REASON_LABEL[p.reason] ?? p.reason}` : ""} <span className="text-outline">&nbsp;{ago(p.createdAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className={cx("money text-sm font-medium", refunded && "text-outline line-through decoration-1")}>{usdc(p.money.agentPaid)}</div>
                {refunded && <div className="money text-xs text-secondary">+{usdc(p.money.refunded)} back</div>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const useApprovals = () => useQuery({ queryKey: ["approvals", "pending"], queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"), refetchInterval: 3000 });

/** Payments held for the owner. Each one is a decision, so each gets its own row with the two answers.
 * `asPanel` wraps the queue in a titled panel that only appears while something is waiting (or just got answered). */
export function ApprovalQueue({ compact, asPanel }: { compact?: boolean; asPanel?: boolean }) {
  const qc = useQueryClient();
  const q = useApprovals();
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get<{ agentPass: boolean }>("/api/auth/config") });
  const [outcome, setOutcome] = useState<{ tone: "green" | "plain"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!outcome) return; const t = setTimeout(() => setOutcome(null), 8000); return () => clearTimeout(t); }, [outcome]);
  const decide = useMutation({
    mutationFn: ({ id, d }: { id: string; d: "approve" | "reject"; agent: string }) => post(`/api/approvals/${id}/${d}`),
    onMutate: () => setOutcome(null),
    onSuccess: (_r, v) => {
      setConfirming(null);
      setOutcome(v.d === "approve"
        ? { tone: "green", text: `Approved. ${v.agent} can retry this payment for 15 minutes.` }
        : { tone: "plain", text: "Declined. Nothing was paid." });
      return qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
  const agentPass = cfg.data?.agentPass === true;
  const params = useSearchParams();
  const world = params.get("world");
  const rows = q.data ?? [];
  const n = rows.length;
  if ((compact || asPanel) && n === 0 && !outcome && !q.isError && !world) return null;

  const body = (
    <div className="space-y-3">
      {world === "approved" && <Note tone="green">Approved. The agent can retry this payment for the next 15 minutes.</Note>}
      {world === "denied" && <Note tone="red">World ID didn&apos;t confirm it was you, so the payment stays blocked.</Note>}
      {outcome && <Note tone={outcome.tone}>{outcome.text}</Note>}
      {decide.isError && <Note tone="red">{decide.error instanceof ApiError && decide.error.code === "expired" ? "That request expired before you decided. The agent can ask again." : "Your decision wasn't saved. Check your connection and try again."}</Note>}
      {q.isError && !q.data ? <LoadError what="payments waiting for approval" retry={() => q.refetch()} /> : !q.data ? <div className="skeleton h-20" /> : n === 0 ? (
        compact || asPanel ? null : <div className="rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant">Nothing is waiting for you. Payments above an agent&apos;s approval limit show up here.</div>
      ) : (
        <ul className={cx("space-y-2", asPanel && "-mx-3 sm:-mx-4")}>
          {rows.map((a) => {
            const busy = decide.isPending && decide.variables?.id === a.id;
            const left = a.expiresAt - now;
            const expired = left <= 0;
            const mins = Math.floor(left / 60000);
            const sure = confirming === a.id;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-surface-container-low px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm"><span className="font-medium">{a.agentName}</span> wants to pay <span className="font-medium">{a.merchantName}</span></div>
                  <div className="mt-0.5 text-xs text-on-surface-variant">
                    {a.merchantScore == null ? "New merchant" : <>Merchant score <span className="money">{a.merchantScore}</span></>}
                    {", "}
                    {expired ? <span className="text-warn">expired</span> : <span className="money">{mins < 1 ? "expires in under 1\u00a0min" : `expires in ${mins}\u00a0min`}</span>}
                  </div>
                </div>
                <div className="money text-lg font-semibold">{usdc(a.amount)}<span className="ml-1 text-xs font-normal text-on-surface-variant">USDC</span></div>
                <div className="flex gap-2">
                  {sure ? (
                    <>
                      <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirming(null)}>Keep waiting</button>
                      <button type="button" className="btn-secondary border-bad text-bad hover:border-bad hover:bg-bad-subtle" disabled={busy || expired} onClick={() => decide.mutate({ id: a.id, d: "reject", agent: a.agentName })}>
                        {busy && decide.variables?.d === "reject" ? "Declining…" : "Confirm decline"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-ghost" disabled={busy || expired} onClick={() => setConfirming(a.id)}>Decline</button>
                      {agentPass && !expired
                        ? <a className="btn-primary" href={`/api/world/oidc/start?purpose=approval&approvalId=${a.id}`}><ShieldCheck className="h-4 w-4" /> Approve</a>
                        : <button type="button" className="btn-primary" disabled={busy || expired} onClick={() => decide.mutate({ id: a.id, d: "approve", agent: a.agentName })}>{busy && decide.variables?.d === "approve" ? "Approving…" : "Approve"}</button>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!compact && !asPanel && n > 0 && (
        <p className="text-xs text-on-surface-variant">Nothing is paid until you approve. {agentPass ? "Approving asks you to confirm with World ID. " : ""}Requests expire after 15 minutes.</p>
      )}
    </div>
  );

  if (!asPanel) return body;
  return (
    <section className="panel" aria-labelledby="approvals-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="approvals-heading" className="font-display text-xl font-semibold tracking-[-0.01em]">
          {n === 0 ? "Approvals" : `${n} ${n === 1 ? "payment needs" : "payments need"} your approval`}
        </h2>
        {n > 0 && <p className="text-xs text-on-surface-variant">Nothing is paid until you approve.{agentPass ? " Approving asks for World ID." : ""}</p>}
      </div>
      {body}
    </section>
  );
}

const NOTE = { green: "bg-ok-subtle text-ok", red: "bg-bad-subtle text-bad", amber: "bg-warn-subtle text-warn", plain: "bg-surface-container-low text-on-surface-variant" };
export function Note({ tone = "plain", children }: { tone?: keyof typeof NOTE; children: React.ReactNode }) {
  return <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-2xl px-4 py-3 text-sm text-pretty", NOTE[tone])}>{children}</div>;
}

/**
 * Pill segmented control for filters. Real buttons with aria-pressed, a 40px track and
 * the shared focus ring, so every filter in the app looks and behaves the same.
 */
export function Segmented<K extends string>({ value, onChange, options, label, className }: {
  value: K; onChange: (k: K) => void; options: readonly (readonly [K, string])[]; label: string; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("inline-flex rounded-full bg-surface-container-low p-1", className)}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cx("h-8 rounded-full px-3.5 text-[13px] transition-colors duration-150",
            value === k ? "bg-surface-container-highest font-medium text-on-surface" : "text-on-surface-variant hover:text-on-surface")}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A data region that failed to load: say what, and offer the one fix. */
export function LoadError({ what, retry, className }: { what: string; retry: () => void; className?: string }) {
  return (
    <div role="alert" className={cx("flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-rule px-6 py-10 text-center text-sm text-on-surface-variant", className)}>
      <p className="text-pretty">Couldn&apos;t load {what}. Check your connection and try again.</p>
      <button type="button" onClick={retry} className="btn-secondary">Try again</button>
    </div>
  );
}
