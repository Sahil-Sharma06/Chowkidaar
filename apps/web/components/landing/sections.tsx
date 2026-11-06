"use client";
/** Below-the-fold landing sections, loaded lazily by app/page.tsx. */
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, BadgeCheck, Bot, Check, CheckCircle2, Fingerprint, Landmark, Network, ScanSearch,
  ShieldCheck, Timer, TriangleAlert, Wallet, X,
} from "lucide-react";
import { formatUsdc, type PublicMerchant, type Receipt } from "@app/shared";
import { HASHSCAN } from "@/lib/api";
import { Money, StatusBadge, cx, reasonLabel } from "@/lib/ui";
import { EASE, Reveal, Stagger, Tilt, item } from "@/components/motion";

const usd = (micro: number | string) => formatUsdc(Math.round(Number(micro))).replace(/\s*USDC$/, "");

/* --------------------------------------------------------------- pillars */
export function Pillars({ price, penalty, feeBps, penaltyBps }: { price: number; penalty: number; feeBps: number; penaltyBps: number }) {
  const pillars = [
    { icon: <Wallet className="h-[22px] w-[22px]" />, n: "01", title: "Merchant skin in the game",
      text: "Merchants deposit USDC into the Hedera vault before they can go live. A failed call is refunded from that bond in the same transaction that slashes it. No support ticket, no arbitration.",
      k: "Minimum bond", v: `10 × (price + ${penaltyBps / 100}%) = ${usd(10 * (price + penalty))} USDC` },
    { icon: <ScanSearch className="h-[22px] w-[22px]" />, n: "02", title: "Objective checks only",
      text: "HTTP status, timeout, empty body, invalid JSON and the merchant's own JSON schema. If the response is wrong-shaped, the agent is refunded. We never judge whether valid-looking data is useful, and we say so.",
      k: "Protection fee", v: `${feeBps / 100}% per call, kept either way` },
    { icon: <Fingerprint className="h-[22px] w-[22px]" />, n: "03", title: "World ID behind every owner",
      text: "Agent owners sign in with World ID Agent Pass: one verified human per account. Calls above an agent's approval threshold stop and wait for a fresh World ID step-up before any money moves.",
      k: "Step-up", v: "OIDC max_age=0 re-auth" },
  ];
  return (
    <section className="mx-auto w-full max-w-7xl space-y-12 px-6 py-20 lg:px-12">
      <Reveal className="max-w-2xl space-y-2">
        <div className="eyebrow font-semibold text-secondary">Clearinghouse architecture</div>
        <h2 className="font-display text-3xl font-semibold tracking-tight">Three pillars of autonomous trust</h2>
        <p className="text-sm text-on-surface-variant">How Chowkidaar removes counterparty risk when machines pay machines a few cents at a time.</p>
      </Reveal>
      <Stagger className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {pillars.map((p) => (
          <motion.div key={p.n} variants={item} className="h-full">
            <Tilt className="h-full">
              <div className="flex h-full flex-col justify-between space-y-4 rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/20 transition-shadow hover:shadow-lg">
                <div className="space-y-4">
                  <motion.div whileHover={{ rotate: 8 }} className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container">{p.icon}</motion.div>
                  <div className="space-y-1.5"><span className="eyebrow text-outline">Pillar {p.n}</span><h3 className="font-display text-base font-semibold">{p.title}</h3></div>
                  <p className="text-xs leading-relaxed text-on-surface-variant">{p.text}</p>
                </div>
                <div className="flex items-center justify-between gap-2 rounded bg-surface-container-low/60 p-3 font-mono text-[11px]"><span className="text-outline">{p.k}:</span><span className="text-right font-semibold text-secondary">{p.v}</span></div>
              </div>
            </Tilt>
          </motion.div>
        ))}
      </Stagger>
    </section>
  );
}

/* ------------------------------------------------------------ comparison */
export function Comparison({ price, fee, penalty, penaltyBps }: { price: number; fee: number; penalty: number; penaltyBps: number }) {
  const bad = [
    ["Unconditional upfront transfer", "USDC leaves the agent before the API has done any work."],
    ["No schema enforcement", "A 200 with an empty or malformed body still gets paid. Nothing to appeal to."],
    ["No recourse on timeouts", "Upstream hangs, merchant keeps the money, the agent's balance quietly drains."],
  ];
  const ok = [
    ["Gateway in the middle", `The agent pays Chowkidaar ${usd(price + fee)} USDC over x402; Chowkidaar pays the merchant and makes the call.`],
    ["Timer + schema on every response", "Status, body, JSON and the merchant's registered schema are checked before the agent sees a byte."],
    [`Bonded ${100 + penaltyBps / 100}% breach protection`, `Refund of ${usd(price)} USDC to the agent, ${usd(price + penalty)} USDC slashed from the bond, all in one Hedera transfer.`],
  ];
  return (
    <section className="w-full bg-surface-container-low/50 py-20">
      <div className="mx-auto max-w-7xl space-y-12 px-6 lg:px-12">
        <Reveal className="mx-auto max-w-2xl space-y-2 text-center">
          <span className="eyebrow text-outline">Side by side</span>
          <h2 className="font-display text-3xl font-semibold tracking-tight">Blind x402 vs Chowkidaar</h2>
          <p className="text-sm text-on-surface-variant">Why agents lose money when they settle raw HTTP 402 payments directly.</p>
        </Reveal>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <CompareCard tone="bad" title="Blind x402" badge="Unsafe for agents" icon={<TriangleAlert className="h-[22px] w-[22px] text-error" />}
            intro="The agent gets a 402, pays the merchant directly, and hopes the response is worth it." rows={bad} />
          <CompareCard tone="ok" title="Chowkidaar" badge="Bond-backed clearing" icon={<ShieldCheck className="h-[22px] w-[22px] text-secondary" />}
            intro="The agent delegates settlement to the gateway. Money only stays with the merchant if the response passes." rows={ok} />
        </div>
      </div>
    </section>
  );
}

function CompareCard({ tone, title, badge, icon, intro, rows }: { tone: "ok" | "bad"; title: string; badge: string; icon: React.ReactNode; intro: string; rows: string[][] }) {
  const ok = tone === "ok";
  return (
    <Reveal delay={ok ? 0.15 : 0}>
      <motion.div whileHover={{ y: -4 }} className={cx("space-y-6 rounded-xl bg-surface-container-lowest p-8 ring-1", ok ? "shadow-md ring-secondary/20" : "shadow-sm ring-outline-variant/20")}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">{icon}<span className="font-display text-base font-semibold">{title}</span></div>
          <span className={cx("rounded px-2 py-0.5 font-mono text-[10px] uppercase", ok ? "bg-secondary-container/25 text-on-secondary-container" : "bg-error-container text-on-error-container")}>{badge}</span>
        </div>
        <p className="text-sm leading-relaxed text-on-surface-variant">{intro}</p>
        <Stagger className="space-y-3">
          {rows.map(([h, d]) => (
            <motion.div key={h} variants={item} className="flex items-start gap-3 rounded bg-surface-container-low p-3 text-xs">
              {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-secondary" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-error" />}
              <div><strong className="block font-semibold text-on-surface">{h}</strong><span className="text-on-surface-variant">{d}</span></div>
            </motion.div>
          ))}
        </Stagger>
      </motion.div>
    </Reveal>
  );
}

/* ----------------------------------------------------------------- roles */
export function Roles({ good }: { good?: PublicMerchant }) {
  return (
    <section className="mx-auto w-full max-w-7xl space-y-12 px-6 py-20 lg:px-12">
      <Reveal className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <span className="eyebrow font-semibold text-secondary">Two dashboards</span>
          <h2 className="font-display text-3xl font-semibold tracking-tight">Built for both sides of the market</h2>
        </div>
        <p className="max-w-md text-xs text-on-surface-variant">Whether you run a fleet of paying agents or sell an API to them.</p>
      </Reveal>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <RoleCard icon={<Bot className="h-5 w-5" />} title="For agent owners" sub="Spend caps and a refund firewall" tag="Owner" href="/owner" delay={0}
          bullets={[
            ["Deterministic spend caps", "A per-call ceiling and a daily budget, enforced before any payment is attempted."],
            ["Bonded allowlist", "Only pay merchants you approved, with a minimum Arkiv score and a bond that covers the call."],
            ["World ID step-up", "Anything above the approval threshold waits for you to re-verify with World ID before it moves."],
          ]}
          box={{ k: "Policy checks", v: "8 · before x402", lines: ["per_call_cap · daily_cap · approval_threshold", "allowlist · min_score · bond_covered · agent_active"] }} />
        <RoleCard icon={<Network className="h-5 w-5" />} title="For API merchants" sub="Get paid instantly, prove you deliver" tag="Merchant" href="/merchant" delay={0.15}
          bullets={[
            ["Instant x402 settlement", "USDC lands in your Hedera account on every call. No 30-day payout, no chargebacks."],
            ["Public Arkiv reputation", "Your score is written to Arkiv by the gateway and read back by agents before they pay."],
            ["Withdraw what's unreserved", "Take back any bond above the minimum at any time. Slashes auto-pause you until you top up."],
          ]}
          box={{ k: good?.name ?? "Merchant", v: good ? (good.covered ? "LIVE · COVERED" : good.status.toUpperCase()) : "—",
            lines: [good ? `bond_available: ${usd(good.bondAvailable)} USDC | price: ${usd(good.price)} USDC` : "—", good ? `arkiv_score: ${good.score ?? "new"} | calls: ${good.totalCalls} | failed: ${good.failedCalls}` : "—"] }} />
      </div>
    </section>
  );
}

function RoleCard({ icon, title, sub, tag, href, bullets, box, delay }: { icon: React.ReactNode; title: string; sub: string; tag: string; href: string; bullets: string[][]; box: { k: string; v: string; lines: string[] }; delay: number }) {
  return (
    <Reveal delay={delay}>
      <Tilt max={4}>
        <div className="space-y-6 rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-container">{icon}</div>
              <div><h3 className="font-display text-base font-semibold">{title}</h3><p className="text-xs text-on-surface-variant">{sub}</p></div>
            </div>
            <Link href={href} className="eyebrow inline-flex items-center gap-1 font-medium text-secondary hover:underline">{tag} <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          <Stagger className="space-y-3">
            {bullets.map(([h, d]) => (
              <motion.div key={h} variants={item} className="flex items-start gap-2.5 text-xs text-on-surface-variant">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                <span><strong className="font-medium text-on-surface">{h}:</strong> {d}</span>
              </motion.div>
            ))}
          </Stagger>
          <div className="space-y-2 rounded-lg bg-surface-container-low p-4">
            <div className="flex items-center justify-between font-mono text-[10px]"><span className="eyebrow text-outline">{box.k}</span><span className="font-semibold text-secondary">{box.v}</span></div>
            <div className="space-y-1 font-mono text-[11px] text-on-surface">{box.lines.map((l, i) => <div key={i} className="truncate">{l}</div>)}</div>
          </div>
        </div>
      </Tilt>
    </Reveal>
  );
}

/* ------------------------------------------------------------- live feed */
export function LiveFeed({ receipts }: { receipts: Receipt[] }) {
  return (
    <section className="w-full bg-surface-container-lowest py-20 shadow-sm">
      <div className="mx-auto max-w-7xl space-y-8 px-6 lg:px-12">
        <Reveal className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-secondary" /><span className="eyebrow font-semibold text-secondary">Real-time verdicts</span></div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Live resolution feed</h2>
            <p className="text-xs text-on-surface-variant">The last six protected calls through this gateway, each anchored on Hedera.</p>
          </div>
          <Link href="/receipts" className="inline-flex items-center gap-1.5 text-xs font-medium hover:text-secondary">Open the receipt explorer <ArrowUpRight className="h-4 w-4" /></Link>
        </Reveal>
        <Reveal className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="eyebrow bg-surface-container-low text-on-surface-variant">
                <th className="rounded-l px-4 py-3 font-medium">Agent</th><th className="px-4 py-3 font-medium">Merchant</th><th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Latency</th><th className="px-4 py-3 font-medium">Verdict</th><th className="rounded-r px-4 py-3 text-right font-medium">Consensus</th>
              </tr>
            </thead>
            <motion.tbody layout className="divide-y divide-surface-container">
              <AnimatePresence initial={false}>
                {receipts.map((r) => {
                  const bad = r.status === "refunded" || r.status === "refund_pending" || r.status === "refund_failed";
                  return (
                    <motion.tr key={r.paymentId} layout initial={{ opacity: 0, y: -14, backgroundColor: "rgba(130,245,193,0.35)" }} animate={{ opacity: 1, y: 0, backgroundColor: bad ? "rgba(255,218,214,0.25)" : "rgba(255,255,255,0)" }}
                      exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: EASE }} className="transition-colors hover:bg-surface-container-low/60">
                      <td className="px-4 py-3.5 font-mono font-medium"><a className="hover:underline" href={`${HASHSCAN}/account/${r.agentAccount}`} target="_blank" rel="noreferrer">{r.agentAccount}</a></td>
                      <td className="px-4 py-3.5 font-mono text-on-surface-variant"><Link className="hover:underline" href={`/receipts/${r.paymentId}`}>{r.merchant.slug}</Link></td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold"><Money micro={r.money.agentPaid} /></td>
                      <td className={cx("px-4 py-3.5 font-mono", r.reason === "timeout" ? "text-error" : "text-on-surface-variant")}>{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={r.status} />{r.reason && <span className="ml-2 text-on-surface-variant">{reasonLabel(r.reason)}</span>}</td>
                      <td className="px-4 py-3.5 text-right">
                        {r.links.hcs && r.hcs.sequence ? (
                          <a className={cx("inline-flex items-center gap-1 font-mono hover:underline", bad ? "text-error" : "text-secondary")} href={r.links.hcs} target="_blank" rel="noreferrer">{r.hcs.topicId}#{r.hcs.sequence} <ArrowUpRight className="h-3.5 w-3.5" /></a>
                        ) : <span className="font-mono text-outline">pending</span>}
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
              {receipts.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-on-surface-variant">No calls yet. <Link className="underline" href="/demo">Run the first one.</Link></td></tr>}
            </motion.tbody>
          </table>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ quickstart */
export function Quickstart({ gatewayUrl, slug }: { gatewayUrl: string; slug: string }) {
  const lines: [string, string][] = [
    ["c", "// 1. Any x402 client works. This is the exact code the demo agent runs."],
    ["k", `import { x402Client } from "@x402/core/client";`],
    ["k", `import { wrapFetchWithPayment } from "@x402/fetch";`],
    ["k", `import { ExactHederaScheme } from "@x402/hedera/exact/client";`],
    ["k", `import { createClientHederaSigner } from "@x402/hedera";`],
    ["", ""],
    ["k", `const signer = createClientHederaSigner(AGENT_ID, agentKey, { network: "hedera:testnet" });`],
    ["k", `const client = x402Client.fromConfig({`],
    ["k", `  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],`],
    ["k", `  spendControls: { maxAmountPerPayment: "$5" },`],
    ["k", `});`],
    ["k", `const pay = wrapFetchWithPayment(fetch, client);`],
    ["", ""],
    ["c", "// 2. Call the merchant through Chowkidaar. 200 = data. 502 = refund already on its way."],
    ["k", `const res = await pay("${gatewayUrl}/v1/call/${slug}", {`],
    ["k", `  method: "POST", headers: { "x-agent-key": AGENT_KEY }, body: "{}",`],
    ["k", `});`],
  ];
  return (
    <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-12">
      <Reveal>
        <div className="relative overflow-hidden rounded-xl bg-primary p-8 text-on-primary shadow-md lg:p-12">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-float rounded-full bg-secondary/30 blur-3xl" />
          <div className="relative space-y-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <span className="eyebrow text-secondary-fixed">Zero changes to your merchant&apos;s API</span>
                <h2 className="font-display text-3xl font-semibold tracking-tight">Guard any agent call with one wrapped fetch</h2>
              </div>
              <a className="btn-secondary px-4 py-2 text-xs" href="https://github.com/Sahil-Sharma06/Chowkidaar#readme" target="_blank" rel="noreferrer">Read the README <ArrowRight className="h-4 w-4" /></a>
            </div>
            <Stagger className="overflow-x-auto rounded-lg bg-white/5 p-5 font-mono text-[12.5px] leading-6 ring-1 ring-white/10">
              {lines.map(([t, l], i) => (
                <motion.div key={i} variants={item} className={cx("whitespace-pre", t === "c" ? "text-primary-fixed-dim" : "text-on-primary", l === "" && "h-3")}>{l}</motion.div>
              ))}
            </Stagger>
            <div className="grid grid-cols-1 gap-4 pt-2 text-xs text-primary-fixed-dim sm:grid-cols-3">
              <span className="flex items-center gap-2"><BadgeCheck className="h-[18px] w-[18px] text-secondary-fixed" /> Merchant keeps its own endpoint and schema</span>
              <span className="flex items-center gap-2"><Timer className="h-[18px] w-[18px] text-secondary-fixed" /> Refund lands in one atomic Hedera transfer</span>
              <span className="flex items-center gap-2"><Landmark className="h-[18px] w-[18px] text-secondary-fixed" /> Public receipt on HCS, reputation on Arkiv</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
