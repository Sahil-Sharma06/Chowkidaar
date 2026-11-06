"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import { ArrowRight, BadgeCheck, Bot, Check, CheckCircle2, Copy, Gavel, Landmark, ShieldCheck, Zap } from "lucide-react";
import { formatUsdc, type PublicMerchant, type PublicStats, type Receipt } from "@app/shared";
import { get, GATEWAY_URL, HASHSCAN, type Config } from "@/lib/api";
import { cx, reasonLabel } from "@/lib/ui";
import { CountUp, EASE, Reveal, SplitWords, Stagger, Tilt, item } from "@/components/motion";

// Everything below the fold loads in its own chunk, only once the hero is on screen.
// (next/dynamic needs the options written out literally at each call site.)
const sections = () => import("@/components/landing/sections");
const Pillars = dynamic(() => sections().then((m) => m.Pillars), { loading: () => <SectionSkeleton />, ssr: false });
const Comparison = dynamic(() => sections().then((m) => m.Comparison), { loading: () => <SectionSkeleton />, ssr: false });
const Roles = dynamic(() => sections().then((m) => m.Roles), { loading: () => <SectionSkeleton />, ssr: false });
const LiveFeed = dynamic(() => sections().then((m) => m.LiveFeed), { loading: () => <SectionSkeleton />, ssr: false });
const Quickstart = dynamic(() => sections().then((m) => m.Quickstart), { loading: () => <SectionSkeleton />, ssr: false });

function SectionSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-20 lg:px-12" aria-busy>
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-10 w-2/3 max-w-xl" />
      <div className="grid gap-6 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-56" />)}</div>
    </div>
  );
}

type AgentStatus = { account: string; usdcMicro: string; usdc: string; hashscan: string };
type Mode = "success" | "breach";

/** Number only; callers add the unit where it belongs. */
const usd = (micro: number | string) => formatUsdc(Math.round(Number(micro))).replace(/\s*USDC$/, "");

export default function Landing() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => get<PublicStats>("/api/public/stats"), refetchInterval: 8000 });
  const merchants = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 8000 });
  const receipts = useQuery({ queryKey: ["public-receipts", 6], queryFn: () => get<Receipt[]>("/api/public/receipts?limit=6"), refetchInterval: 4000 });
  const agent = useQuery({ queryKey: ["agent-status"], queryFn: () => get<AgentStatus>("/demo-agent/status"), refetchInterval: 10_000, retry: false });

  const c = cfg.data;
  const feeBps = c?.feeBps ?? 200;
  const penaltyBps = c?.penaltyBps ?? 2000;
  // The merchant we feature: the best-rated one whose bond covers a call right now.
  const good = [...(merchants.data ?? [])].sort((x, y) => Number(y.covered) - Number(x.covered) || (y.score ?? -1) - (x.score ?? -1))[0];
  const price = Number(good?.price ?? 100_000);
  const fee = Math.floor((price * feeBps) / 10_000);
  const penalty = Math.floor((price * penaltyBps) / 10_000);
  const bondTotal = (merchants.data ?? []).reduce((s, m) => s + Number(m.bondAvailable), 0);
  const latest = receipts.data?.[0];

  return (
    <div className="flex w-full flex-col">
      <Hero gatewayUrl={GATEWAY_URL} slug={good?.slug ?? "<merchant>"} />

      <section className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-20 lg:px-12">
        <Topology cfg={c} good={good} agent={agent.data} price={price} fee={fee} penalty={penalty} penaltyBps={penaltyBps} latest={latest} />
      </section>

      <MerchantMarquee merchants={merchants.data ?? []} />

      {/* Trust counters */}
      <section className="w-full bg-surface-container-lowest py-12 shadow-sm">
        <Stagger className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 lg:grid-cols-4 lg:px-12">
          <Metric label="Available bond" value={<CountUp value={bondTotal} format={usd} />} unit="USDC"
            hint={c ? <a className="hover:underline" href={`${HASHSCAN}/account/${c.vaultAccount}`} target="_blank" rel="noreferrer">Held in vault {c.vaultAccount}</a> : "Held in the Hedera vault"} />
          <Metric label="Protected calls" value={<CountUp value={stats.data?.protectedCalls ?? 0} />}
            hint={stats.data ? `${stats.data.protectedCalls - stats.data.refunds} delivered, ${stats.data.refunds} refunded` : "Live from the gateway"} />
          <Metric label="Refunded to agents" value={<CountUp value={Number(stats.data?.usdcRefunded ?? 0)} format={usd} />} unit="USDC"
            hint={<span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-secondary" /> Paid from merchant bonds</span>} />
          <Metric label="Live merchants" value={<CountUp value={stats.data?.merchants ?? 0} />}
            hint={<span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 text-outline" /> Bonded and accepting calls</span>} />
        </Stagger>
      </section>

      <Pillars price={price} penalty={penalty} feeBps={feeBps} penaltyBps={penaltyBps} />
      <Comparison price={price} fee={fee} penalty={penalty} penaltyBps={penaltyBps} />
      <Roles good={good} />
      <LiveFeed receipts={receipts.data ?? []} />
      <Quickstart gatewayUrl={GATEWAY_URL} slug={good?.slug ?? "<merchant>"} />

      {/* CTA */}
      <section className="w-full bg-surface-container-low/70 py-16">
        <Reveal className="mx-auto max-w-4xl space-y-6 px-6 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Ready to protect your agent&apos;s capital?</h2>
          <p className="mx-auto max-w-xl text-base text-on-surface-variant">Run a real paid call in the sandbox, or sign in with World ID to set spend caps for your own agents.</p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <MagneticLink href="/demo" className="btn-primary px-6 py-3">Launch sandbox demo</MagneticLink>
            <MagneticLink href="/merchants" className="btn-secondary px-6 py-3">Browse bonded merchants</MagneticLink>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */
function Hero({ gatewayUrl, slug }: { gatewayUrl: string; slug: string }) {
  const mx = useMotionValue(50);
  const my = useMotionValue(35);
  const spotlight = useMotionTemplate`radial-gradient(640px circle at ${mx}% ${my}%, rgba(0,108,74,0.14), transparent 65%)`;
  const endpoint = `${gatewayUrl}/v1/call/${slug}`;
  const [copied, setCopied] = useState(false);

  return (
    <section className="relative w-full overflow-hidden"
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); mx.set(((e.clientX - r.left) / r.width) * 100); my.set(((e.clientY - r.top) / r.height) * 100); }}>
      {/* drifting grid + spotlight + floating orbs */}
      <div className="pointer-events-none absolute inset-0 animate-grid-drift bg-[linear-gradient(to_right,rgba(26,27,34,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(26,27,34,0.07)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
      <motion.div className="pointer-events-none absolute inset-0" style={{ background: spotlight }} />
      <div className="pointer-events-none absolute -left-24 top-24 h-72 w-72 animate-float rounded-full bg-secondary-container/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-48 h-80 w-80 animate-float-slow rounded-full bg-surface-variant blur-3xl" />

      <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center space-y-6 px-6 pt-14 text-center">
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center gap-2.5 rounded-full bg-surface-container-high/70 px-3.5 py-1.5 shadow-sm backdrop-blur-sm">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-secondary" /></span>
          <span className="eyebrow text-on-surface">Hedera · x402 · World ID · Arkiv</span>
          <span className="font-mono text-[10px] text-outline-variant">·</span>
          <span className="font-mono text-[10px] text-on-surface-variant">Real testnet settlement</span>
        </motion.div>

        <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          <SplitWords text="You only pay for" />
          <span className="relative inline-block">
            <SplitWords text="what works." delay={0.3} className="text-shimmer" />
            <motion.span className="absolute -bottom-1 left-0 h-[5px] w-full origin-left rounded-full bg-secondary/40" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.9 }} />
          </span>
        </h1>

        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.55 }}
          className="max-w-2xl text-base leading-relaxed text-on-surface-variant sm:text-lg">
          Chowkidaar sits between autonomous AI agents and paid APIs. If a service times out, crashes, or returns the wrong shape,
          the agent is refunded on-chain from the merchant&apos;s bonded USDC. No tickets, no humans in the loop.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.7 }}
          className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <MagneticLink href="/demo" className="btn-primary group px-5 py-2.5">
            Launch sandbox demo <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </MagneticLink>
          <MagneticLink href="/login" className="btn-secondary px-5 py-2.5">
            <BadgeCheck className="h-[18px] w-[18px] text-secondary" /> Continue with World ID
          </MagneticLink>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}
          className="inline-flex max-w-full items-center gap-3 rounded-lg bg-surface-container-lowest px-3.5 py-1.5 shadow-sm">
          <span className="font-mono text-[11px] text-outline">POST</span>
          <code className="truncate font-mono text-[11px] text-on-surface">{endpoint}</code>
          <span className="hidden font-mono text-[10px] text-on-surface-variant sm:inline">→ 402 → pay → 200</span>
          <button type="button" title="Copy endpoint" className="rounded p-1 text-on-surface-variant transition-colors hover:text-on-surface"
            onClick={async () => { await navigator.clipboard.writeText(endpoint); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="h-4 w-4 text-secondary" /> : <Copy className="h-4 w-4" />}
          </button>
        </motion.div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- topology */
function Topology({ cfg, good, agent, price, fee, penalty, penaltyBps, latest }:
  { cfg?: Config; good?: PublicMerchant; agent?: AgentStatus; price: number; fee: number; penalty: number; penaltyBps: number; latest?: Receipt }) {
  const [mode, setMode] = useState<Mode>("success");
  const breach = mode === "breach";
  const topic = cfg?.hcsTopicId;

  return (
    <motion.div initial={{ opacity: 0, y: 40, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.9, ease: EASE, delay: 0.9 }}
      className="mt-14 w-full rounded-xl bg-surface-container-lowest p-6 shadow-md ring-1 ring-outline-variant/20 lg:p-8">
      <div className="flex flex-col justify-between gap-4 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary"><ShieldCheck className="h-[18px] w-[18px]" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-semibold">Chowkidaar settlement topology</span>
              {topic ? (
                <a href={`${HASHSCAN}/topic/${topic}`} target="_blank" rel="noreferrer" className="rounded bg-secondary-container/25 px-2 py-0.5 font-mono text-[10px] font-semibold text-on-secondary-container hover:underline">LIVE TOPIC {topic}</a>
              ) : <span className="rounded bg-surface-container px-2 py-0.5 font-mono text-[10px] text-on-surface-variant">HCS OFF</span>}
            </div>
            <p className="text-xs text-on-surface-variant">Pay, check, settle or refund. Every step lands on Hedera; the receipt lands on HCS.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <span className="eyebrow text-on-surface-variant">Simulate:</span>
          <div className="relative flex rounded-lg bg-surface-container-low p-1 font-mono text-[11px]">
            {(["success", "breach"] as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cx("relative z-10 rounded px-2.5 py-1 transition-colors", mode === m ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface")}>
                {mode === m && <motion.span layoutId="sim-pill" className="absolute inset-0 rounded bg-surface-container-lowest shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                <span className="relative">{m === "success" ? "200 Delivered" : "500 Refund + slash"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative w-full space-y-6 rounded-xl bg-surface-container-low/70 p-6 lg:p-8">
        <FlowRail mode={mode} />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Node eyebrow="Caller agent" tag={agent?.account ?? "demo agent"} title="Autonomous buyer" icon={<Bot className="h-4 w-4" />}
            text="The demo agent holds its own Hedera key and pays the gateway over x402 with @x402/fetch. The gateway never sees the key."
            rows={[["Owner auth", "World ID Agent Pass", "text-secondary"], ["Quote", `${usd(price + fee)} USDC`, "font-semibold"], ["Wallet", agent ? agent.usdc : "—", ""]]} />

          <motion.div animate={breach ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.5 }}>
            <motion.div className="relative h-full rounded-lg bg-surface-container-lowest p-5"
              animate={{ boxShadow: breach ? "0 0 0 2px rgba(186,26,26,0.45), 0 12px 48px rgba(186,26,26,0.22)" : "0 0 0 1px rgba(0,108,74,0.35), 0 12px 48px rgba(0,108,74,0.18)" }}
              transition={{ duration: 0.6 }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={cx("h-2 w-2 rounded-full", breach ? "bg-error" : "animate-pulse bg-secondary")} />
                  <span className={cx("eyebrow font-semibold", breach ? "text-error" : "text-secondary")}>{breach ? "Fault detected" : "Guarding call"}</span>
                </div>
                <span className="font-mono text-[10px] text-outline">{cfg?.gatewayAccount ?? "gateway"}</span>
              </div>
              <div className="mt-3 space-y-1">
                <div className="font-display text-base font-semibold">Chowkidaar gateway</div>
                <p className="text-xs text-on-surface-variant">Pays the merchant upfront over x402, runs the timer and the merchant&apos;s own JSON schema, then settles or refunds.</p>
              </div>
              <div className="mt-3 space-y-1 rounded bg-surface-container-low p-2.5 font-mono text-[11px]">
                <div className="flex justify-between"><span className="text-outline">Timer:</span>
                  <AnimatePresence mode="wait"><motion.span key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className={breach ? "font-bold text-error" : "font-semibold"}>{breach ? "HTTP 500 at 0.4 s" : "0.4 s / 10 s budget"}</motion.span></AnimatePresence></div>
                <div className="flex justify-between"><span className="text-outline">Checks:</span>
                  <AnimatePresence mode="wait"><motion.span key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className={breach ? "font-medium text-error" : "font-medium text-secondary"}>{breach ? "CASE_A → REFUND" : "SCHEMA_VALID"}</motion.span></AnimatePresence></div>
              </div>
            </motion.div>
          </motion.div>

          <Node eyebrow="API merchant" tag={good?.slug ?? "merchant"} title={good?.name ?? "Merchant"} icon={<Landmark className="h-4 w-4" />}
            text="A real x402 seller on Hedera testnet. It posted a USDC bond into the vault before it could go live."
            rows={[["Bond available", good ? `${usd(good.bondAvailable)} USDC` : "—", "font-semibold"], ["Arkiv score", good ? (good.score == null ? `New (${good.totalCalls} calls)` : `${good.score}/100`) : "—", "text-secondary"], ["Covered", good ? (good.covered ? "yes" : "no") : "—", good?.covered ? "text-secondary" : "text-error"]]} />
        </div>

        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
          <OutcomeCard active={!breach} tone="ok" icon={<CheckCircle2 className="h-5 w-5 text-secondary" />} title="Outcome A · Delivered" tag="200 OK · schema valid · in time">
            Valid JSON within the merchant&apos;s timeout. The merchant keeps the <b className="font-mono text-on-surface">{usd(price)} USDC</b> it was paid upfront,
            Chowkidaar keeps the <b className="font-mono text-on-surface">{usd(fee)} USDC</b> fee, and the merchant&apos;s Arkiv reputation ticks up.
          </OutcomeCard>
          <OutcomeCard active={breach} tone="bad" icon={<Gavel className="h-5 w-5 text-error" />} title="Outcome B · Refund + slash" tag="5xx · timeout · empty · malformed">
            The agent is refunded <b className="font-mono text-on-surface">{usd(price)} USDC</b> from the vault in one atomic Hedera transfer, and the merchant&apos;s bond is slashed
            <b className="font-mono text-error"> {usd(price + penalty)} USDC</b> (price + {penaltyBps / 100}% penalty). The failure is written to Arkiv.
          </OutcomeCard>
        </div>

        <div className="flex flex-col justify-between gap-2 pt-2 font-mono text-[11px] text-on-surface-variant sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-secondary" />
            {latest?.links.hcs && latest.hcs.sequence ? (
              <span>Latest receipt: <a className="text-on-surface hover:underline" href={latest.links.hcs} target="_blank" rel="noreferrer">HCS #{latest.hcs.sequence}</a> · {latest.merchant.name} · {reasonLabel(latest.reason) || "delivered"}</span>
            ) : <span>Receipts are anchored on Hedera Consensus Service</span>}
          </div>
          <div>Finality: <span className="font-medium text-secondary">Hedera consensus timestamp, ~3–5 s</span></div>
        </div>
      </div>
    </motion.div>
  );
}

/** The payment packet travelling agent → gateway → merchant, and the data (or the refund) coming back. */
function FlowRail({ mode }: { mode: Mode }) {
  const green = "#006c4a", dark = "#1a1b22", red = "#ba1a1a";
  const anim = mode === "success"
    ? { left: ["16.6%", "50%", "83.3%", "83.3%", "16.6%"], backgroundColor: [green, green, green, dark, dark], scale: [1, 1.2, 1, 1.4, 1] }
    : { left: ["16.6%", "50%", "83.3%", "83.3%", "50%", "16.6%"], backgroundColor: [green, green, green, red, red, red], scale: [1, 1.2, 1, 1.6, 1.2, 1] };
  return (
    <div className="relative hidden h-8 md:block" aria-hidden>
      <div className="absolute inset-x-[16.6%] top-1/2 h-px -translate-y-1/2 bg-[repeating-linear-gradient(90deg,rgba(26,27,34,0.25)_0_6px,transparent_6px_12px)]" />
      <motion.div className="absolute inset-x-[16.6%] top-1/2 h-px -translate-y-1/2 origin-left bg-gradient-to-r from-secondary via-secondary to-transparent"
        animate={{ scaleX: [0, 1, 1, 0], opacity: [0.8, 0.8, 0.3, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }} />
      {["16.6%", "50%", "83.3%"].map((l) => (
        <span key={l} className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-on-surface bg-surface-container-lowest" style={{ left: l }} />
      ))}
      <motion.div key={mode} className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_18px_rgba(0,108,74,0.6)]"
        animate={anim} transition={{ duration: mode === "success" ? 3.4 : 3.8, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" }} />
      <div className="absolute left-[33%] -top-1 -translate-x-1/2 font-mono text-[9px] uppercase tracking-wider text-outline">x402 pay</div>
      <div className="absolute left-[66.6%] -top-1 -translate-x-1/2 font-mono text-[9px] uppercase tracking-wider text-outline">x402 upfront</div>
    </div>
  );
}

function Node({ eyebrow, tag, title, text, rows, icon }: { eyebrow: string; tag: string; title: string; text: string; icon: React.ReactNode; rows: [string, string, string][] }) {
  return (
    <Tilt className="h-full">
      <motion.div whileHover={{ y: -4 }} className="h-full space-y-3 rounded-lg bg-surface-container-lowest p-5 shadow-sm ring-1 ring-outline-variant/20">
        <div className="flex items-center justify-between">
          <span className="eyebrow inline-flex items-center gap-1.5 text-outline">{icon}{eyebrow}</span>
          <span className="rounded bg-surface-container px-2 py-0.5 font-mono text-[10px] text-on-surface-variant">{tag}</span>
        </div>
        <div className="space-y-1">
          <div className="font-display text-base font-semibold">{title}</div>
          <p className="text-xs text-on-surface-variant">{text}</p>
        </div>
        <div className="space-y-1 rounded bg-surface-container-low p-2.5 font-mono text-[11px]">
          {rows.map(([k, v, cls]) => <div key={k} className="flex justify-between gap-2"><span className="text-outline">{k}:</span><span className={cx("truncate", cls)}>{v}</span></div>)}
        </div>
      </motion.div>
    </Tilt>
  );
}

function OutcomeCard({ active, tone, icon, title, tag, children }: { active: boolean; tone: "ok" | "bad"; icon: React.ReactNode; title: string; tag: string; children: React.ReactNode }) {
  return (
    <motion.div animate={{ opacity: active ? 1 : 0.45, scale: active ? 1 : 0.985 }} transition={{ duration: 0.4 }}
      className={cx("space-y-2 rounded-lg bg-surface-container-lowest p-4 shadow-sm ring-1", active ? (tone === "ok" ? "ring-secondary/40" : "ring-error/40") : "ring-outline-variant/20")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">{icon}<span className={cx("eyebrow font-semibold", tone === "ok" ? "text-secondary" : "text-error")}>{title}</span></div>
        <span className="font-mono text-[10px] text-outline">{tag}</span>
      </div>
      <p className="text-xs leading-relaxed text-on-surface-variant">{children}</p>
    </motion.div>
  );
}

/* --------------------------------------------------------------- marquee */
function MerchantMarquee({ merchants }: { merchants: PublicMerchant[] }) {
  if (merchants.length === 0) return null;
  const items = [...merchants, ...merchants];
  return (
    <div className="marquee relative w-full overflow-hidden border-y border-outline-variant/20 bg-surface-container-lowest py-3 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee-track flex w-max animate-marquee gap-3">
        {items.map((m, i) => (
          <Link key={`${m.id}-${i}`} href="/merchants" className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-1.5 text-xs transition-colors hover:bg-surface-container">
            <span className={cx("h-1.5 w-1.5 rounded-full", m.covered ? "bg-secondary" : "bg-error")} />
            <span className="font-medium">{m.name}</span>
            <span className="font-mono text-[10px] text-on-surface-variant">{usd(m.price)} USDC</span>
            <span className="font-mono text-[10px] text-on-surface-variant">bond {usd(m.bondAvailable)}</span>
            <span className={cx("font-mono text-[10px] font-semibold", m.score == null ? "text-outline" : m.score >= 80 ? "text-secondary" : "text-error")}>{m.score == null ? "new" : `${m.score}/100`}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- metrics */
function Metric({ label, value, unit, hint }: { label: string; value: React.ReactNode; unit?: string; hint?: React.ReactNode }) {
  return (
    <motion.div variants={item} className="space-y-1">
      <div className="eyebrow text-outline">{label}</div>
      <div className="font-display text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{value}{unit && <span className="ml-1.5 text-base font-medium text-on-surface-variant">{unit}</span>}</div>
      <div className="flex items-center gap-1.5 text-xs text-on-surface-variant"><span className="h-1.5 w-1.5 rounded-full bg-secondary" />{hint}</div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- helpers */
function MagneticLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const x = useSpring(0, { stiffness: 300, damping: 20 });
  const y = useSpring(0, { stiffness: 300, damping: 20 });
  return (
    <motion.div style={{ x, y }}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left - r.width / 2) * 0.25); y.set((e.clientY - r.top - r.height / 2) * 0.35); }}
      onMouseLeave={() => { x.set(0); y.set(0); }} whileTap={{ scale: 0.97 }}>
      <Link href={href} className={className}>{children}</Link>
    </motion.div>
  );
}
