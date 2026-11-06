"use client";
import { formatUsdc, hashscanTx, PAYMENT_STATUS, REASON_LABEL } from "@app/shared";
import { ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { HASHSCAN } from "./api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const PILL: Record<string, string> = { green: "pill-ok", amber: "pill-warn", red: "pill-bad", blue: "pill-info", grey: "pill-muted" };

export function Badge({ tone = "grey", children }: { tone?: keyof typeof PILL | string; children: React.ReactNode }) {
  return <span className={cx("pill", PILL[tone] ?? PILL.grey)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const s = PAYMENT_STATUS[status as keyof typeof PAYMENT_STATUS];
  return <Badge tone={s?.color ?? "grey"}>{s?.label ?? status}</Badge>;
}

export const reasonLabel = (r: string | null | undefined) => (r ? REASON_LABEL[r] ?? r : "");

export function Money({ micro, className }: { micro: string | number | null | undefined; className?: string }) {
  return <span className={cx("money", className)}>{formatUsdc(micro)}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="money font-display text-[28px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-2 text-sm text-on-surface-variant">{label}</div>
      {hint && <div className="mt-1 text-xs text-outline">{hint}</div>}
    </div>
  );
}

export function TxLink({ id, label, href }: { id?: string | null; label?: string; href?: string | null }) {
  const url = href ?? (id ? hashscanTx(id, HASHSCAN) : null);
  if (!url) return <span className="text-outline">–</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-on-surface underline decoration-outline underline-offset-4 transition-colors hover:text-primary hover:decoration-primary">
      {label ?? (id ? `${id.slice(0, 22)}…` : "View")} <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

/** Copies `text`. The icon cross-fades to a check and a live region says "Copied" (or why it failed). */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState("done"); }
    catch { setState("failed"); }
    setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button type="button" className="btn-ghost relative h-9 w-9 shrink-0 p-0 after:absolute after:-inset-1" onClick={copy} aria-label={label}>
      <span className="grid place-items-center">
        <Copy className={cx("h-4 w-4 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] [grid-area:1/1]", state === "idle" ? "scale-100 opacity-100 blur-none" : "scale-25 opacity-0 blur-[4px]")} />
        <Check className={cx("h-4 w-4 text-gain transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] [grid-area:1/1]", state === "done" ? "scale-100 opacity-100 blur-none" : "scale-25 opacity-0 blur-[4px]")} />
      </span>
      <span role="status" className="sr-only">{state === "done" ? "Copied" : state === "failed" ? "Couldn't copy. Select the text and copy it by hand." : ""}</span>
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-outline">{hint}</span>}
    </label>
  );
}

const NOTE = { green: "bg-ok-subtle text-ok", amber: "bg-warn-subtle text-warn", red: "bg-bad-subtle text-bad", blue: "bg-surface-container-low text-on-surface-variant" };
/** An inline message. Blue is neutral information, so it stays quiet. */
export function Alert({ tone = "amber", children }: { tone?: keyof typeof NOTE; children: React.ReactNode }) {
  return <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-2xl px-4 py-3 text-sm leading-relaxed text-pretty", NOTE[tone])}>{children}</div>;
}

export function Empty({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-4 rounded-[24px] border border-dashed border-rule px-6 py-14 text-center text-sm text-on-surface-variant"><div>{title}</div>{action}</div>;
}

export const fmtTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" }) : "–");
export const usdcInput = (micro: number) => (micro / 1_000_000).toString();
export const microFromInput = (s: string) => { const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim()); if (!m) throw new Error("Enter a USDC amount with up to 6 decimals"); return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0")); };
