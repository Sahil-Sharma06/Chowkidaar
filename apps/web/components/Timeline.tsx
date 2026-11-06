"use client";
import type { DemoStep } from "@app/shared";
import { Check, Circle, ExternalLink, Loader2, Minus, X } from "lucide-react";
import { cx } from "@/lib/ui";

const ICON: Record<DemoStep["state"], React.ReactNode> = {
  pending: <Circle className="h-3 w-3" />,
  running: <Loader2 className="h-4 w-4 animate-spin" />,
  done: <Check className="h-4 w-4" />,
  failed: <X className="h-4 w-4" />,
  skipped: <Minus className="h-4 w-4" />,
};

const DISC: Record<DemoStep["state"], string> = {
  pending: "bg-surface-container text-outline",
  running: "bg-info-subtle text-info",
  done: "bg-primary text-on-primary",
  failed: "bg-bad-subtle text-bad",
  skipped: "bg-surface-container text-outline",
};

/** What happened, in order. Lime for steps that finished, red for the one that failed. */
export function Timeline({ steps }: { steps: DemoStep[] }) {
  return (
    <ol>
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", DISC[s.state])}>{ICON[s.state]}</div>
            {i < steps.length - 1 && <div className={cx("my-1 w-0.5 flex-1 rounded-full", s.state === "done" ? "bg-primary/40" : "bg-outline-variant")} />}
          </div>
          <div className={cx("min-w-0 pt-1.5", i < steps.length - 1 && "pb-6")}>
            <div className={cx("text-[15px] font-medium leading-tight", (s.state === "pending" || s.state === "skipped") && "text-on-surface-variant", s.state === "failed" && "text-bad")}>{s.label}</div>
            {s.detail && <div className="mt-1 break-words text-sm text-on-surface-variant">{s.detail}</div>}
            {s.link && (
              <a className="mt-1.5 inline-flex items-center gap-1 text-xs text-on-surface-variant underline decoration-outline underline-offset-4 transition-colors hover:text-primary hover:decoration-primary" href={s.link} target="_blank" rel="noreferrer">
                View on explorer <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
