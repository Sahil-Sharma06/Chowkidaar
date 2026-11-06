"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Minus, X } from "lucide-react";
import { PAYMENT_STATUS, POLICY_ERROR_LABEL, type DemoRunResult, type DemoStep, type Receipt } from "@app/shared";
import { ApiError, get } from "@/lib/api";
import { Alert, Money, TxLink, cx, reasonLabel } from "@/lib/ui";
import { usdc } from "@/components/owner/kit";

const FINAL = new Set(["delivered", "refunded", "refund_failed"]);
const fmt = (m: string) => `${(Number(m) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;

/** The approval id a 202 "held" run came back with, so the next run of the same target can reuse it. */
export const heldApprovalId = (run: DemoRunResult | null) =>
  run?.gatewayStatus === 202 ? (run.gatewayResponse as { approvalId?: string } | null)?.approvalId : undefined;

/* ------------------------------------------------------------------ request errors */

export type Explained = { text: string; signIn?: boolean; retryable: boolean };

/** Codes the gateway answers with on these routes, in words a person can act on. */
const CODE_TEXT: Record<string, string> = {
  not_found: "This agent no longer exists. Pick another agent.",
  merchant_not_found: "That merchant isn't in the catalog any more. Pick another one.",
  not_custodial: "This agent pays with its own key, so it can't pay from here. Pick an agent whose wallet we hold.",
  unknown_scenario: "That merchant can't be run here. Pick another one.",
  agent_paused: "This agent is paused. Resume it from its page, then try again.",
};

/** What a failed request means for the person, and whether trying again can help. */
export function explainError(e: unknown, offline = "Couldn't reach the gateway. Try again."): Explained {
  if (!(e instanceof ApiError)) return { text: offline, retryable: true };
  if (e.status === 401) return { text: "Your session ended. Sign in again to keep going.", signIn: true, retryable: false };
  if (e.status === 403) return { text: CODE_TEXT[e.code] ?? "You're not allowed to do this with this agent.", retryable: false };
  if (e.status === 429) return { text: "Too many requests at once. Wait a few seconds, then try again.", retryable: true };
  if (e.status >= 500) return { text: offline, retryable: true };
  if (e.code === "invalid_input") {
    const detail = String((e.body as { detail?: unknown })?.detail ?? "");
    if (detail.startsWith("query")) return { text: "Say what you want in up to 2,000 characters.", retryable: false };
    if (detail.startsWith("slug")) return { text: "That merchant name isn't valid. Pick a merchant from the list.", retryable: false };
    if (detail.startsWith("body")) return { text: "The request body must be a JSON object, like { \"query\": \"hbar-price\" }.", retryable: false };
    return { text: "The gateway couldn't read this request. Check what you entered and try again.", retryable: false };
  }
  return { text: CODE_TEXT[e.code] ?? "The gateway turned this request down. Check what you entered and try again.", retryable: false };
}

function technical(e: unknown) {
  if (e instanceof ApiError) return `HTTP ${e.status} ${e.code}\n${typeof e.body === "string" ? e.body : JSON.stringify(e.body, null, 2)}`;
  return String((e as Error)?.message ?? e);
}

/** A disclosure for the raw detail a developer needs and nobody else does. */
export function TechDetails({ children, label = "Technical details" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-xs text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden">
        {label} <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface-variant">{children}</pre>
    </details>
  );
}

/** A failed request: what happened, the one thing to do next, and the raw detail tucked away. */
export function ErrorCard({ error, onRetry, retryLabel = "Try again", offline, extra, className }: {
  error: unknown; onRetry?: () => void; retryLabel?: string; offline?: string; extra?: React.ReactNode; className?: string;
}) {
  const x = explainError(error, offline);
  return (
    <div role="alert" className={cx("space-y-2 rounded-2xl bg-bad-subtle px-4 py-3 text-sm", className)}>
      <p className="text-bad">{x.text}</p>
      {(x.signIn || (onRetry && x.retryable)) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {x.signIn ? <Link className="btn-secondary" href="/login">Sign in again</Link> : <button type="button" className="btn-secondary" onClick={onRetry}>{retryLabel}</button>}
        </div>
      )}
      {extra}
      <TechDetails>{technical(error)}</TechDetails>
    </div>
  );
}

/* ------------------------------------------------------------------ run timeline */

const OUTCOME: Record<string, [label: string, pill: string]> = {
  idle: ["Not run yet", "pill-muted"],
  running: ["In progress", "pill-info"],
  blocked: ["Blocked before payment", "pill-muted"],
  held: ["Needs your approval", "pill-warn"],
  error: ["Didn't finish", "pill-bad"],
  calling: [PAYMENT_STATUS.calling.label, "pill-info"],
  delivered: [PAYMENT_STATUS.delivered.label, "pill-ok"],
  refund_pending: ["Refunding", "pill-warn"],
  refunded: [PAYMENT_STATUS.refunded.label, "pill-info"],
  refund_failed: [PAYMENT_STATUS.refund_failed.label, "pill-bad"],
};

/** Timeline + outcome panel for one run. Polls the public receipt until the worker has finished it. */
export function RunView({ run, pending, children }: { run: DemoRunResult | null; pending: boolean; children?: React.ReactNode }) {
  const receipt = useQuery({
    queryKey: ["receipt", run?.paymentId],
    queryFn: () => get<Receipt>(`/api/public/receipts/${run!.paymentId}`),
    enabled: Boolean(run?.paymentId),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && FINAL.has(d.status) && (d.hcs.sequence || !d.hcs.topicId) ? false : 1500;
    },
  });
  const held = heldApprovalId(run);

  const steps = run ? run.steps.map((s) => {
    const r = receipt.data;
    if (!r) return s;
    if (s.key === "outcome" && FINAL.has(r.status)) {
      return { ...s, state: "done" as const, detail: r.status === "delivered" ? "Delivered" : r.status === "refunded" ? `Refunded ${fmt(r.money.refunded)}${Number(r.money.bondSlashed) > 0 ? `, bond slashed ${fmt(r.money.bondSlashed)}` : ""}` : "Refund failed, flagged on the dashboard for retry", link: r.links.refund ?? undefined };
    }
    if (s.key === "merchant_pay" && r.links.merchant) return { ...s, link: r.links.merchant };
    if (s.key === "agent_pay" && r.links.agent) return { ...s, link: r.links.agent };
    if (s.key === "hcs") return r.hcs.sequence ? { ...s, state: "done" as const, detail: `Sequence #${r.hcs.sequence}`, link: r.links.hcs ?? undefined } : !r.hcs.topicId ? { ...s, state: "skipped" as const, detail: "HCS topic not configured" } : { ...s, state: "running" as const, detail: "Waiting for the worker" };
    return s;
  }) : [];

  const outcome = receipt.data?.status ?? (held ? "held" : run?.outcome === "blocked" ? "blocked" : run?.outcome === "error" ? "error" : run ? "running" : "idle");
  const [label, pill] = OUTCOME[outcome] ?? [outcome, "pill-muted"];
  const r = receipt.data;
  const blockedCode = String((run?.gatewayResponse as { error?: string } | null)?.error ?? "");

  return (
    <>
      <section className="panel min-h-[320px]" aria-busy={pending}>
        <h2 className="mb-5 font-display text-xl font-semibold tracking-[-0.01em]">What happened</h2>
        {run ? <Steps steps={steps} /> : pending ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">Paying. Steps appear here as they finish.</span>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-11" aria-hidden />)}
          </div>
        ) : (
          <p className="max-w-sm text-sm text-on-surface-variant">Pick a merchant and pay. Each step of the payment, from your agent&apos;s wallet to the merchant&apos;s answer, shows up here as it happens.</p>
        )}
        {run?.error && (
          <div role="alert" className="mt-4 space-y-1 rounded-2xl bg-bad-subtle px-4 py-3 text-sm">
            <p className="text-bad">The payment stopped before it finished. No money moved past the failed step.</p>
            <TechDetails>{run.error}</TechDetails>
          </div>
        )}
      </section>

      <aside className="panel space-y-5">
        <span role="status" className="sr-only">{run ? `Outcome: ${label}` : ""}</span>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Outcome</h2>
          <span className={cx("pill", pill)}>{label}</span>
        </div>

        {run?.paymentId && !r && (receipt.isError
          ? <p className="text-sm text-on-surface-variant">Couldn&apos;t load the receipt yet. Retrying…</p>
          : <div className="space-y-2" aria-hidden><div className="skeleton h-10 w-40" /><div className="skeleton h-4 w-28" /></div>)}

        {r && (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{usdc(r.money.agentPaid)}</span>
              <span className="text-sm text-on-surface-variant">USDC</span>
            </div>
            <div className="mt-2 text-sm text-on-surface-variant">Paid by your agent</div>
            {Number(r.money.refunded) > 0 && <div className="money mt-3 text-sm font-medium text-gain">+{fmt(r.money.refunded)} refunded to you</div>}
          </div>
        )}

        {run?.outcome === "blocked" && !held && <Alert tone="blue">Stopped before any payment{blockedCode ? <>: <span className="font-medium text-on-surface">{POLICY_ERROR_LABEL[blockedCode] ?? "a limit you set"}</span></> : ""}. No money moved.</Alert>}
        {held && <Alert tone="amber">Held for your approval. No money moved. <Link className="font-medium underline underline-offset-4" href="/owner/approvals">Approve it</Link> with World ID, then pay again.</Alert>}

        {r && (
          <dl className="divide-y divide-rule text-sm">
            {r.reason && <Row k="Reason">{reasonLabel(r.reason)}</Row>}
            <Row k="Merchant received"><Money micro={r.money.merchantReceived} /></Row>
            <Row k="Refunded"><Money micro={r.money.refunded} /></Row>
            <Row k="Bond slashed"><Money micro={r.money.bondSlashed} /></Row>
            <Row k="Agent payment"><TxLink id={r.tx.agent} label="HashScan" /></Row>
            <Row k="Merchant payment"><TxLink id={r.tx.merchant} label="HashScan" /></Row>
            <Row k="Refund"><TxLink id={r.tx.refund} label="HashScan" /></Row>
            <Row k="HCS record"><TxLink href={r.links.hcs} label={r.hcs.sequence ? `#${r.hcs.sequence}` : undefined} /></Row>
          </dl>
        )}

        {run?.paymentId && <Link className="btn-secondary w-full" href={`/receipts/${run.paymentId}`}>Open receipt</Link>}
        {children}
      </aside>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-on-surface-variant">{k}</dt><dd className="text-right">{children}</dd></div>;
}

const ICON: Record<DemoStep["state"], [React.ReactNode, string, string]> = {
  pending: [<span key="p" className="h-1.5 w-1.5 rounded-full bg-outline" />, "bg-surface-container", "Not started"],
  running: [<Loader2 key="r" className="h-3.5 w-3.5 animate-spin" />, "bg-info-subtle text-info", "In progress"],
  done: [<Check key="d" className="h-3.5 w-3.5" />, "bg-ok-subtle text-ok", "Done"],
  failed: [<X key="f" className="h-3.5 w-3.5" />, "bg-bad-subtle text-bad", "Failed"],
  skipped: [<Minus key="s" className="h-3.5 w-3.5" />, "bg-surface-container text-outline", "Skipped"],
};

/** The payment's steps as a vertical track. Done steps are lit; the line between them fills as it goes. */
function Steps({ steps }: { steps: DemoStep[] }) {
  return (
    <ol>
      {steps.map((s, i) => {
        const [icon, cls, word] = ICON[s.state];
        return (
          <li key={s.key} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", cls)} aria-hidden>{icon}</span>
              {i < steps.length - 1 && <span className={cx("my-1 w-px flex-1", s.state === "done" ? "bg-rule-strong" : "bg-rule")} aria-hidden />}
            </div>
            <div className="min-w-0 pb-5 pt-0.5">
              <div className={cx("text-sm font-medium", s.state === "pending" ? "text-outline" : "text-on-surface")}>{s.label}<span className="sr-only">: {word}</span></div>
              {s.detail && <div className="mt-0.5 break-words text-xs text-on-surface-variant">{s.detail}</div>}
              {s.link && <a className="mt-1 inline-flex min-h-6 items-center text-xs text-on-surface-variant underline decoration-outline underline-offset-4 transition-colors hover:text-primary" href={s.link} target="_blank" rel="noreferrer">View on explorer</a>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
