"use client";
import { useId } from "react";
import { motion } from "framer-motion";
import { cx } from "@/lib/ui";

/** Smooth line through the points, as an SVG path in a w x h box. */
function curve(values: number[], w: number, h: number, pad = 3) {
  const max = Math.max(...values, 1e-9);
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : (i / (values.length - 1)) * w, h - pad - (v / max) * (h - pad * 2)] as const);
  return pts.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const mx = (px + x) / 2;
    return `${d} C${mx},${py} ${mx},${y} ${x},${y}`;
  }, "");
}

/**
 * A small line chart. `area` fills under the line with a fade to nothing.
 * The box stretches to its container, so there is no end dot (it would turn into an ellipse);
 * the stroke stays 2px because it doesn't scale.
 */
export function Spark({ values, area, className, label }: { values: number[]; area?: boolean; className?: string; label?: string }) {
  const w = 120, h = 44;
  const id = useId();
  const d = curve(values, w, h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cx("h-11 w-28", className)} preserveAspectRatio="none"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {area && (
        <>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-primary)" stopOpacity={0.12} />
              <stop offset="1" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id}-fill)`} />
        </>
      )}
      <path d={d} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * One thin bar per bucket, from zero: height is the bucket's share of the busiest one.
 * Empty buckets get a 2px stub so the time axis stays readable. Only the latest bucket is lit.
 */
export function Ticks({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className={cx("flex h-11 items-end gap-[5px]", className)} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {values.map((v, i) => {
        const last = i === values.length - 1;
        return (
          <span key={i} className={cx("w-[3px] rounded-full", last ? "bg-primary" : v > 0 ? "bg-outline" : "bg-surface-container-highest")}
            style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : "2px" }} />
        );
      })}
    </div>
  );
}

/** Half-circle of dashes; the share that is lit is `pct`. Always put the number next to it. */
export function Gauge({ pct, className }: { pct: number; className?: string }) {
  const n = 13, lit = Math.round((Math.max(0, Math.min(100, pct)) / 100) * n);
  return (
    <svg viewBox="0 0 120 64" className={cx("h-11 w-28", className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const a = Math.PI - (i / (n - 1)) * Math.PI;
        const c = Math.cos(a), s = Math.sin(a);
        return <line key={i} x1={60 + c * 44} y1={60 - s * 44} x2={60 + c * 56} y2={60 - s * 56} stroke={i < lit ? "var(--color-primary)" : "var(--color-surface-container-high)"} strokeWidth={3} strokeLinecap="round" />;
      })}
    </svg>
  );
}

export type Day = { label: string; spent: number; cap: number; today: boolean };

/** A neutral fill that holds 3:1 against the track (WCAG 1.4.11) without competing with today's lime. */
const PAST_FILL = "color-mix(in oklab, var(--color-outline) 80%, var(--color-surface-container))";

/**
 * Daily spend against the daily budget. Each column is one day's budget: the solid fill is what was
 * spent (true height, 3px minimum when anything was spent), the stripes above it are what was left.
 * Every day's amount is printed above its column, so nothing needs a hover. Today is lit.
 */
export function BudgetBars({ days, format, full }: { days: Day[]; format: (micro: number) => string; full?: (micro: number) => string }) {
  const long = full ?? format;
  return (
    <div className="h-full">
      <div className="grid h-full grid-cols-7 gap-2 sm:gap-3" aria-hidden>
        {days.map((d, i) => {
          const pct = d.cap > 0 ? Math.min(100, (d.spent / d.cap) * 100) : 0;
          return (
            <div key={d.label} className="flex h-full min-w-0 flex-col items-center gap-2">
              <span className={cx("money whitespace-nowrap text-xs", d.today ? "font-medium text-on-surface" : "text-on-surface-variant")}>{format(d.spent)}</span>
              <div className="hatch relative w-full max-w-10 flex-1 overflow-hidden rounded-full bg-surface-container">
                {d.spent > 0 && (
                  <motion.div
                    className={cx("absolute inset-x-0 bottom-0 origin-bottom rounded-full", d.today && "bg-primary")}
                    style={{ height: `max(3px, ${pct}%)`, background: d.today ? undefined : PAST_FILL }}
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                    transition={{ duration: 0.5, delay: i * 0.03, ease: [0.2, 0, 0, 1] }}
                  />
                )}
              </div>
              <span className={cx("text-xs", d.today ? "font-medium text-on-surface" : "text-on-surface-variant")}>{d.label}</span>
            </div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>Spending per day against the daily budget</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Spent (USDC)</th><th scope="col">Daily budget (USDC)</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{long(d.spent)}</td><td>{long(d.cap)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
