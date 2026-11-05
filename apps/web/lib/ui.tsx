"use client";
import { formatUsdc, hashscanTx, PAYMENT_STATUS, REASON_LABEL } from "@app/shared";
import { ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { HASHSCAN } from "./api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const TONE: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  grey: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function Badge({ tone = "grey", children }: { tone?: keyof typeof TONE | string; children: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone] ?? TONE.grey)}>{children}</span>;
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
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold money">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function TxLink({ id, label, href }: { id?: string | null; label?: string; href?: string | null }) {
  const url = href ?? (id ? hashscanTx(id, HASHSCAN) : null);
  if (!url) return <span className="text-slate-400">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
      {label ?? (id ? `${id.slice(0, 22)}…` : "View")} <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn-ghost px-2 py-1" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }} aria-label="Copy">
      {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Alert({ tone = "amber", children }: { tone?: "amber" | "red" | "blue" | "green"; children: React.ReactNode }) {
  return <div className={cx("rounded-lg px-4 py-3 text-sm ring-1 ring-inset", TONE[tone])}>{children}</div>;
}

export function Empty({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="card flex flex-col items-center gap-3 py-10 text-center text-slate-500"><div>{title}</div>{action}</div>;
}

export const fmtTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleString() : "—");
export const usdcInput = (micro: number) => (micro / 1_000_000).toString();
export const microFromInput = (s: string) => { const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim()); if (!m) throw new Error("Enter a USDC amount with up to 6 decimals"); return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0")); };
