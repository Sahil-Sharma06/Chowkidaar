"use client";
import type { DemoStep } from "@app/shared";
import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import { cx } from "@/lib/ui";

const ICON: Record<DemoStep["state"], React.ReactNode> = {
  pending: <Circle className="h-4 w-4 text-slate-300" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-600" />,
  done: <Check className="h-4 w-4 text-emerald-600" />,
  failed: <X className="h-4 w-4 text-rose-600" />,
  skipped: <Minus className="h-4 w-4 text-slate-400" />,
};

export function Timeline({ steps }: { steps: DemoStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cx("flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset", s.state === "done" ? "bg-emerald-50 ring-emerald-200" : s.state === "failed" ? "bg-rose-50 ring-rose-200" : s.state === "running" ? "bg-blue-50 ring-blue-200" : "bg-slate-50 ring-slate-200")}>{ICON[s.state]}</div>
            {i < steps.length - 1 && <div className="my-1 w-px flex-1 bg-slate-200" />}
          </div>
          <div className="pb-2">
            <div className={cx("text-sm font-medium", s.state === "pending" && "text-slate-400")}>{s.label}</div>
            {s.detail && <div className="text-xs text-slate-600">{s.detail}</div>}
            {s.link && <a className="text-xs text-blue-700 hover:underline" href={s.link} target="_blank" rel="noreferrer">View on explorer</a>}
          </div>
        </li>
      ))}
    </ol>
  );
}
