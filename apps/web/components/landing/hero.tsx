"use client";
/** The first screen: a centred headline, two actions, and the console itself playing a guarded payment with live numbers. */
import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import type { PublicMerchant } from "@app/shared";
import { cx } from "@/lib/ui";
import { usdc } from "@/components/owner/kit";
import { Logo } from "@/components/Logo";
import { GuardedPayment, type AgentStatus } from "./payment";
import { StartCta, WRAP } from "./sections";

const NBSP = " ";

/* One short entrance: text settles, then the product frame. Nothing moves under reduced motion. */
const CSS = `
@keyframes ck-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.ck-in { animation: ck-in 600ms cubic-bezier(0.2,0,0,1) both }
.ck-in-2 { animation-delay: 60ms } .ck-in-3 { animation-delay: 120ms } .ck-in-4 { animation-delay: 220ms; animation-duration: 800ms }
@media (prefers-reduced-motion: reduce) { .ck-in { animation: none } }`;

export const FRAME_SHADOW = "shadow-[0_1px_2px_rgb(16_16_20/0.06),0_24px_60px_-24px_rgb(16_16_20/0.25)]";

export function Hero({ good, agent, price, fee, penalty, latency, feeBps }: {
  good?: PublicMerchant; agent?: AgentStatus; price: number; fee: number; penalty: number; latency?: number | null; feeBps: number;
}) {
  return (
    <section>
      <style>{CSS}</style>
      <div className={cx(WRAP, "flex flex-col items-center pt-14 text-center sm:pt-24")}>
        <Link href="/receipts"
          className="ck-in group inline-flex max-w-full items-center gap-2 rounded-full border border-rule bg-surface-container-lowest py-1 pl-1 pr-3 text-[13px] text-on-surface-variant shadow-[0_1px_2px_rgb(16_16_20/0.04)] transition-colors hover:border-rule-strong hover:text-on-surface">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container-low px-2.5 py-0.5 font-medium text-on-surface">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />Live on Hedera testnet
          </span>
          <span className="truncate">See the latest receipts</span>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-outline transition-transform group-hover:translate-x-0.5" />
        </Link>

        <h1 className="ck-in ck-in-2 mt-7 max-w-[11em] text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-on-surface sm:text-[56px] lg:text-[72px] lg:leading-[1.02]">
          You only pay for what works
        </h1>
        <p className="ck-in ck-in-3 mt-6 max-w-[40em] text-[17px] leading-relaxed text-on-surface-variant sm:text-[19px]">
          Chowkidaar sits between autonomous AI agents and paid APIs. If a service times out, crashes, or returns the wrong shape, the agent is refunded on-chain from the merchant&apos;s bonded USDC. No tickets, no humans in the loop.
        </p>
        <div className="ck-in ck-in-3 mt-9 flex flex-wrap items-center justify-center gap-3">
          <StartCta className="h-11 px-5 text-[15px]" />
        </div>
        <p className="ck-in ck-in-3 money mt-5 text-[13px] text-outline">{feeBps / 100}% per call. Test USDC is free.</p>
      </div>

      <div className="ck-in ck-in-4 mx-auto mt-14 w-full max-w-[1120px] px-4 sm:mt-20 sm:px-6 lg:px-8">
        <BrowserFrame>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_248px] lg:grid-cols-[188px_minmax(0,1fr)_264px]">
            <Sidebar />
            <div className="min-w-0">
              <div aria-hidden className="flex h-12 items-center gap-2 border-b border-rule px-5 text-[13px] sm:px-7">
                <span className="text-on-surface-variant">Payments</span>
                <ChevronRight className="h-3.5 w-3.5 text-outline" />
                <span className="truncate font-medium">Latest payment</span>
              </div>
              <GuardedPayment good={good} agent={agent} price={price} fee={fee} penalty={penalty} latency={latency} className="px-5 py-6 sm:px-7 sm:py-7" />
            </div>
            <Aside good={good} agent={agent} />
          </div>
        </BrowserFrame>
      </div>

      <TrustStrip />
    </section>
  );
}

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx("overflow-hidden rounded-2xl border border-rule bg-surface-container-lowest text-left", FRAME_SHADOW)}>
      <div aria-hidden className="relative flex h-10 items-center border-b border-rule bg-surface-container-low px-4">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
          <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
          <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
        </div>
        <div className="absolute left-1/2 flex h-6 w-[min(300px,56%)] -translate-x-1/2 items-center justify-center gap-1.5 rounded-md border border-rule bg-surface-container-lowest text-[12px] text-on-surface-variant">
          <Lock className="h-3 w-3 text-outline" />chowkidaar.app/console
        </div>
      </div>
      {children}
    </div>
  );
}

/** The console's sidebar, as a still. */
function Sidebar() {
  const items = ["Overview", "Agents", "Payments", "Approvals", "Merchants"];
  return (
    <div aria-hidden className="hidden flex-col border-r border-rule bg-surface-container-low/60 px-3 py-4 lg:flex">
      <div className="flex items-center gap-2 px-2">
        <Logo className="h-[18px] w-[18px]" />
        <span className="text-sm font-semibold tracking-[-0.01em]">Chowkidaar</span>
      </div>
      <ul className="mt-6 space-y-0.5 text-[13px]">
        {items.map((n) => (
          <li key={n} className={cx("rounded-md px-2 py-1.5", n === "Payments" ? "bg-surface-container font-medium text-on-surface" : "text-on-surface-variant")}>{n}</li>
        ))}
      </ul>
      <div className="mt-auto flex items-center gap-2 px-2 pt-10 text-[12px] text-outline">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />Hedera testnet
      </div>
    </div>
  );
}

/** The agent and merchant beside the payment: live balance, live bond and score, example limits. */
function Aside({ good, agent }: { good?: PublicMerchant; agent?: AgentStatus }) {
  const limits: [string, string][] = [["Per payment", "0.50"], ["Per day", "5.00"], ["Ask me above", "0.25"]];
  return (
    <div aria-hidden className="hidden border-l border-rule md:block">
      <div className="border-b border-rule px-5 py-5">
        <div className="text-[12px] text-outline">Agent</div>
        <div className="mt-1 text-sm font-medium">Demo agent</div>
        <div className="money text-[12px] text-on-surface-variant">{agent?.account ?? "0.0.…"}</div>
        <div className="mt-4 text-[12px] text-outline">Wallet balance</div>
        <div className="money mt-0.5 text-xl font-semibold tracking-[-0.02em]">
          {agent ? usdc(agent.usdcMicro) : "–"}<span className="ml-1 text-[12px] font-normal tracking-normal text-on-surface-variant">USDC</span>
        </div>
      </div>
      <div className="border-b border-rule px-5 py-5">
        <div className="text-[12px] text-outline">Limits</div>
        <dl className="mt-2 space-y-2 text-[13px]">
          {limits.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-on-surface-variant">{k}</dt>
              <dd className="money">{v}{NBSP}USDC</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-container-high">
          <div className="h-full w-[22%] rounded-full bg-on-surface" />
        </div>
        <div className="money mt-1.5 text-[12px] text-outline">1.10 of 5.00 spent today</div>
      </div>
      <div className="px-5 py-5">
        <div className="text-[12px] text-outline">Merchant</div>
        <div className="mt-1 truncate text-sm font-medium">{good?.name ?? "–"}</div>
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-variant">Score</dt>
            <dd className="money">{good?.score != null ? `${good.score} / 100` : "New"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-variant">Bond</dt>
            <dd className="money">{good ? `${usdc(good.bondAvailable)}${NBSP}USDC` : "–"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-variant">Calls</dt>
            <dd className="money">{good ? good.totalCalls.toLocaleString() : "–"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const BUILT_ON = ["Hedera", "x402", "World ID", "Arkiv"];
function TrustStrip() {
  return (
    <div className={cx(WRAP, "pt-16 sm:pt-20")}>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-10">
        <span className="text-[13px] text-outline">Built on</span>
        <ul className="flex items-center gap-x-7 sm:gap-x-12">
          {BUILT_ON.map((n) => (
            <li key={n} className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em] text-on-surface-variant/75 sm:text-xl">{n}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
