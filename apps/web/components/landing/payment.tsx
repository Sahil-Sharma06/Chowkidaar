"use client";
/** The hero's product view: one payment played step by step with the featured merchant's live numbers. */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Pause, Play, X } from "lucide-react";
import type { PublicMerchant } from "@app/shared";
import { cx } from "@/lib/ui";
import { usdc } from "@/components/owner/kit";

export type AgentStatus = { account: string; usdcMicro: string; usdc: string; hashscan: string };

type Mode = "delivered" | "fails";
const LAST = 3; // index of the final step
const STEP_MS = 420; // per step while a payment plays out
const HOLD_MS = 2400; // how long a finished outcome stays on screen before the next one
const NBSP = " ";
const OUTCOMES = [["delivered", "Delivered"], ["fails", "Service fails"]] as const;

/**
 * Starts on the finished "delivered" state, then alternates outcomes on its own (about 4 s each).
 * The loop waits while the pointer or focus is inside, while it is off screen or the tab is hidden,
 * and stops for good when the visitor pauses it or picks an outcome. Reduced motion: no loop.
 */
export function GuardedPayment({ good, agent, price, fee, penalty, latency, className }:
  { good?: PublicMerchant; agent?: AgentStatus; price: number; fee: number; penalty: number; latency?: number | null; className?: string }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>("delivered");
  const [step, setStep] = useState(LAST + 1);
  const [auto, setAuto] = useState(true);
  const [held, setHeld] = useState(false); // pointer or focus inside
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const fails = mode === "fails";
  const done = step > LAST;

  useEffect(() => { if (reduce) { setAuto(false); setStep(LAST + 1); } }, [reduce]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    const vis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", vis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const visible = onScreen && tabVisible;
  useEffect(() => {
    if (!visible) return;
    if (!done) {
      // A payment in progress always finishes, even under the pointer: it answers a click.
      const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 300 : STEP_MS);
      return () => clearTimeout(t);
    }
    if (!auto || held || reduce) return;
    const t = setTimeout(() => { setMode((m) => (m === "delivered" ? "fails" : "delivered")); setStep(0); }, HOLD_MS);
    return () => clearTimeout(t);
  }, [step, done, auto, held, visible, reduce]);

  // Picking an outcome stops the loop and plays that outcome (again, if it is the one on screen).
  const pick = (m: Mode) => { setAuto(false); setMode(m); setStep(reduce ? LAST + 1 : 0); };

  // Play starts the next outcome at once, rather than waiting for the pointer to leave.
  const toggle = () => {
    if (auto) { setAuto(false); return; }
    setAuto(true);
    if (done && !reduce) { setMode((m) => (m === "delivered" ? "fails" : "delivered")); setStep(0); }
  };

  const total = price + fee;
  const bond = Number(good?.bondAvailable ?? 0);
  const slash = price + penalty;
  const covers = slash > 0 ? Math.floor(bond / slash) : 0;
  const segs = 12;
  const lit = Math.min(segs, covers);
  const name = good?.name ?? "a bonded merchant";

  const steps: { title: string; detail: string; tone?: "bad" | "gain" }[] = [
    { title: "Agent paid", detail: `${usdc(total)}${NBSP}USDC over x402 from ${agent?.account ?? "the demo agent"}` },
    { title: "Limits checked", detail: "Under the per-payment cap and today's budget" },
    fails
      ? { title: "Service returned an error", detail: "HTTP 500, so the call counts as failed", tone: "bad" }
      : { title: latency != null ? `Delivered in ${latency.toLocaleString()}${NBSP}ms` : "Delivered on time", detail: "Valid JSON that matches the merchant's schema" },
    fails
      ? { title: "Refunded from the bond", detail: `${usdc(price)}${NBSP}USDC back to the agent in one Hedera transfer`, tone: "gain" }
      : { title: "Merchant paid", detail: `${usdc(price)}${NBSP}USDC to ${name}, ${usdc(fee)}${NBSP}USDC fee` },
  ];

  const leave = (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false); };

  return (
    <div ref={ref} className={className}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") setHeld(true); }} onPointerLeave={() => setHeld(false)}
      onFocus={(e) => { if (e.target.matches(":focus-visible")) setHeld(true); }} onBlur={leave}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-medium">Payment to {name}</p>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label="Show outcome" className="inline-flex rounded-[10px] border border-rule bg-surface-container-low p-0.5">
            {OUTCOMES.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => pick(k)}
                className={cx("h-7 rounded-lg px-3 text-[13px] transition-[background-color,color,box-shadow] duration-150",
                  mode === k ? "bg-surface-container-lowest font-medium text-on-surface shadow-[0_1px_2px_rgb(16_16_20/0.08),0_0_0_1px_rgb(16_16_20/0.04)]"
                    : "text-on-surface-variant hover:text-on-surface")}>
                {l}
              </button>
            ))}
          </div>
          {!reduce && <button type="button" onClick={toggle} aria-label={auto ? "Pause the example" : "Play the example"}
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface after:absolute after:-inset-1">
            {auto ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div>
          <div className="text-[13px] text-on-surface-variant">Paid by the agent for one call</div>
          <div className="money mt-1.5 flex items-baseline gap-2 text-[40px] font-semibold leading-none tracking-[-0.03em] sm:text-[44px]">
            <span className={cx("transition-colors duration-300", fails && done && "text-outline line-through decoration-2")}>{usdc(total)}</span>
            <span className="text-[15px] font-normal tracking-normal text-on-surface-variant">USDC</span>
          </div>
        </div>
        <div className="text-right" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={done ? mode : "pending"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
              {!done ? <span className="pill pill-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the call</span>
                : fails ? (
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="pill pill-info">Refunded</span>
                    <span className="money text-sm font-medium text-gain">+{usdc(price)}{NBSP}USDC back</span>
                  </div>
                ) : <span className="pill pill-ok">Delivered</span>}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <ol className="mt-6">
        {steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "running" : "waiting";
          return (
            <li key={i} className={cx("relative flex gap-3.5 pb-5 last:pb-0 transition-opacity duration-200", state === "waiting" && "opacity-45")}>
              {i < LAST && <span aria-hidden className="absolute bottom-0 left-[11px] top-7 w-px bg-rule" />}
              <span className={cx("relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                state === "done" ? (s.tone === "bad" ? "bg-bad text-white" : s.tone === "gain" ? "bg-brand text-white" : "bg-on-surface text-on-primary")
                  : "border border-rule-strong bg-surface-container-lowest text-outline")}>
                {state === "done" ? (s.tone === "bad" ? <X className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Check className="h-3.5 w-3.5" strokeWidth={2.5} />)
                  : state === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="money text-[11px]">{i + 1}</span>}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className={cx("text-sm font-medium leading-5", state === "done" && s.tone === "bad" && "text-bad")}>{s.title}</div>
                <div className="money mt-0.5 text-[13px] leading-5 text-on-surface-variant">{s.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-xl border border-rule bg-surface-container-low px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-on-surface-variant">{good ? `${good.name}'s bond` : "Merchant bond"}</span>
          {good ? <span className="money font-medium">{usdc(bond)}{NBSP}USDC</span> : <span className="skeleton h-4 w-20 rounded-full" />}
        </div>
        {/* One segment per failed call the bond can cover. The one this call locks turns ink, and red if it is spent. */}
        <div className="mt-2.5 flex h-1.5 gap-1" aria-hidden>
          {Array.from({ length: segs }, (_, i) => {
            const mine = i === lit - 1;
            return (
              <span key={i} className={cx("flex-1 rounded-full transition-colors duration-300",
                i >= lit ? "hatch" : mine && fails && done ? "bg-bad" : mine && !done ? "bg-on-surface" : "bg-surface-container-highest")} />
            );
          })}
        </div>
        <p className="mt-2.5 text-[13px] text-on-surface-variant">
          {!good ? "Every merchant posts a bond before it can take payments."
            : !done ? <>This call locks <span className="money text-on-surface">{usdc(slash)}{NBSP}USDC</span> of the bond until it finishes.</>
              : fails ? <><span className="money text-on-surface">{usdc(slash)}{NBSP}USDC</span> taken from the bond, penalty included.</>
                : <>Covers <span className="money text-on-surface">{covers.toLocaleString()}</span> failed calls like this one.</>}
        </p>
      </div>
    </div>
  );
}
