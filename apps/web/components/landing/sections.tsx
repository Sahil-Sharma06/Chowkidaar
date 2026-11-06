"use client";
/** Landing sections below the hero. Each one explains one part of the product with a piece of the real UI. */
import Link from "next/link";
import { ArrowUp, Plus } from "lucide-react";
import type { PublicMerchant } from "@app/shared";
import { GATEWAY_URL } from "@/lib/api";
import { cx } from "@/lib/ui";
import { usdc } from "@/components/owner/kit";
import { useMe } from "@/components/Guard";
import { Logo } from "@/components/Logo";
import { CodeEditor, type EditorFile } from "./editor";

export const WRAP = "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8";
export const SECTION = "py-14 sm:py-16 lg:py-20";
export const EYEBROW = "text-sm font-medium text-on-surface-variant";
export const H2 = "mt-3 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-on-surface sm:text-[40px] lg:text-[44px]";
export const LEAD = "text-[17px] leading-relaxed text-on-surface-variant sm:text-lg";
export const LINK = "text-on-surface underline decoration-rule-strong underline-offset-4 transition-colors hover:decoration-on-surface";
const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";
const DOCS = `${REPO}/blob/main/docs/API.md`;
const NBSP = " ";

/* Merchants that exist to show a failure in the demo. Never featured. */
const DEMO_FAILURES = new Set(["dodgy-diner", "mystery-meals", "silent-dj", "lofi-radio", "quickcab", "honest-cab", "vip-table", "premium-feed"]);

/** The merchant to feature: SkyCast if it's live, else the best-rated bonded merchant that isn't a failure demo. */
export function featured(list?: PublicMerchant[]) {
  const ok = (list ?? []).filter((m) => m.covered && !DEMO_FAILURES.has(m.slug) && !/Expect: refund/i.test(m.description ?? ""));
  const rank = (m: PublicMerchant) => (m.slug === "skycast" ? 2 : 0) + (m.score != null ? 1 + m.score / 100 : 0) + (/^(live|real)\b|coingecko/i.test(m.description ?? "") ? 0.5 : 0);
  return [...ok].sort((x, y) => rank(y) - rank(x))[0] ?? (list ?? []).find((m) => m.covered);
}

/** Signed-in visitors go straight to their workspace instead of the sign-in page. */
export function StartCta({ className }: { className?: string }) {
  const me = useMe();
  const href = me.data?.roles.owner ? "/owner" : me.data?.roles.merchant ? "/merchant" : me.data ? "/onboarding" : "/login";
  return <Link href={href} className={cx("btn-primary", className)}>{me.data ? "Open dashboard" : "Create an agent"}</Link>;
}

/* ------------------------------------------------------- how it works */
export function HowItWorks({ feeBps, price }: { feeBps: number; price: number }) {
  const nodes = [
    { title: "Your agent", sub: "Claude, a script or a bot", body: `Calls a merchant through Chowkidaar with its key and pays the price plus ${feeBps / 100}%.` },
    { title: "Chowkidaar", sub: "Checks your limits", body: "Checks the caps, budget and merchant score, pays the merchant, then checks the answer.", gate: true },
    { title: "Merchant API", sub: "Any x402 API with a bond", body: "Answers as usual. Good data goes straight back to your agent." },
  ];
  const back = `+${usdc(price)}${NBSP}USDC`;
  return (
    <section className={cx(WRAP, SECTION)} aria-labelledby="how-h">
      <div className="max-w-2xl">
        <p className={EYEBROW}>How it works</p>
        <h2 id="how-h" className={H2}>A checkpoint between your agent and every API it pays</h2>
      </div>

      {/* Wide screens: one horizontal flow with the refund path running back underneath. */}
      <div className="relative mt-16 hidden lg:block" role="img"
        aria-label={`Your agent pays Chowkidaar, which checks its limits and pays the merchant API. If the call fails, the agent is refunded ${back} from the merchant's bond.`}>
        <div className="relative grid grid-cols-3">
          <span aria-hidden className="absolute left-[16.67%] right-[16.67%] top-[44px] h-px bg-rule-strong" />
          {nodes.map((n, i) => (
            <div key={n.title} className="relative flex justify-center">
              <Node {...n} arrow={i > 0} />
            </div>
          ))}
          <EdgeLabel at="left-1/3">Pays in USDC</EdgeLabel>
          <EdgeLabel at="left-2/3">Pays and calls</EdgeLabel>
        </div>
        {/* The return path: from the merchant's bond back up into the agent. */}
        <div aria-hidden className="relative mx-[16.67%] h-[72px] rounded-b-[20px] border-x border-b border-dashed border-gain/45">
          <svg viewBox="0 0 10 6" className="absolute -left-[5.5px] -top-[1px] h-[6px] w-[10px] text-gain/70"><path d="M5 0 10 6H0Z" fill="currentColor" /></svg>
          <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-rule bg-surface-container-lowest px-3.5 py-1.5 text-[13px] shadow-[0_1px_2px_rgb(16_16_20/0.04)]">
            <span className="text-on-surface-variant">Call fails? Refund from the merchant&apos;s bond</span>
            <span className="money font-medium text-gain">{back}</span>
          </span>
        </div>
        <ol className="mt-12 grid grid-cols-3">
          {nodes.map((n, i) => (
            <li key={n.title} className="mx-auto w-[72%] pr-2 text-[15px] leading-relaxed text-on-surface-variant">
              <span className="money mr-2 text-outline">{i + 1}</span>{n.body}
            </li>
          ))}
        </ol>
      </div>

      {/* Narrow screens: the same flow, top to bottom. */}
      <ol className="mt-12 lg:hidden">
        {nodes.map((n, i) => (
          <li key={n.title}>
            {i > 0 && (
              <div aria-hidden className="flex h-12 items-center">
                <span className="ml-8 h-full w-px bg-rule-strong" />
                <span className="ml-4 text-[13px] text-on-surface-variant">{i === 1 ? "Pays in USDC" : "Pays and calls"}</span>
              </div>
            )}
            <div className="rounded-2xl border border-rule bg-surface-container-lowest px-5 py-4 shadow-[0_1px_2px_rgb(16_16_20/0.04)]">
              <div className="flex items-center gap-2 text-[15px] font-medium">{n.gate && <Logo className="h-4 w-4" />}{n.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{n.body}</p>
            </div>
          </li>
        ))}
        <li className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-gain/45 px-5 py-4">
          <ArrowUp aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gain" />
          <p className="text-sm leading-relaxed text-on-surface-variant">
            Call fails? The agent gets <span className="money font-medium text-gain">{back}</span> back from the merchant&apos;s bond.
          </p>
        </li>
      </ol>
    </section>
  );
}

function Node({ title, sub, gate, arrow }: { title: string; sub: string; gate?: boolean; arrow?: boolean }) {
  return (
    <div className={cx("relative z-10 flex h-[88px] w-[72%] flex-col justify-center rounded-2xl border bg-surface-container-lowest px-5",
      gate ? "border-rule-strong shadow-[0_1px_2px_rgb(16_16_20/0.06),0_12px_32px_-16px_rgb(16_16_20/0.22)]" : "border-rule shadow-[0_1px_2px_rgb(16_16_20/0.04)]")}>
      {arrow && (
        <svg aria-hidden viewBox="0 0 6 10" className="absolute -left-[7px] top-1/2 h-[10px] w-[6px] -translate-y-1/2 text-field"><path d="M0 0 6 5 0 10Z" fill="currentColor" /></svg>
      )}
      <div className="flex items-center gap-2 text-[15px] font-medium">{gate && <Logo className="h-4 w-4" />}{title}</div>
      <div className="mt-0.5 text-[13px] text-on-surface-variant">{sub}</div>
    </div>
  );
}

function EdgeLabel({ at, children }: { at: string; children: React.ReactNode }) {
  return <span aria-hidden className={cx("absolute top-[18px] -translate-x-1/2 whitespace-nowrap text-[12px] text-on-surface-variant", at)}>{children}</span>;
}

/* ------------------------------------------------------------ rules */
export function Rules() {
  return (
    <section className={cx(WRAP, SECTION, "grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16")} aria-labelledby="rules-h">
      <div className="min-w-0 lg:col-span-5">
        <p className={EYEBROW}>Limits</p>
        <h2 id="rules-h" className={H2}>Rules you set for each agent</h2>
        <p className={cx(LEAD, "mt-5 max-w-[42ch]")}>
          Every payment is checked against them before any money moves. Anything above your approval line waits for you.
        </p>
        <ul className="mt-8 max-w-[42ch] divide-y divide-rule border-y border-rule text-[15px]">
          {[["A cap per payment", "and a budget per day"], ["A minimum merchant score", "from its public record"], ["Merchants you pick", "and nobody else"]].map(([a, b]) => (
            <li key={a} className="py-3"><span className="font-medium text-on-surface">{a}</span> <span className="text-on-surface-variant">{b}</span></li>
          ))}
        </ul>
      </div>
      <figure className="min-w-0 lg:col-span-7">
        <LimitsFragment />
        <figcaption className="sr-only">
          Example agent limits: 0.50 USDC per payment, 5 USDC per day, approval asked above 0.25 USDC, minimum merchant score 60, two merchants allowed.
        </figcaption>
      </figure>
    </section>
  );
}

/** A still of the agent's Limits tab. Not interactive. */
function LimitsFragment() {
  const limits: [string, string, string, string][] = [
    ["Per payment", "The most it can spend on a single call.", "0.50", "USDC"],
    ["Per day", "Resets at midnight UTC.", "5.00", "USDC"],
    ["Ask me above", "Bigger payments wait for your approval.", "0.25", "USDC"],
    ["Minimum merchant score", "Out of 100.", "60", ""],
  ];
  const picks: [string, string, boolean][] = [
    ["SkyCast", "0.02 USDC, score 94", true],
    ["HBAR Price Feed", "0.01 USDC, score 100", true],
    ["StreamTune", "0.01 USDC, new", false],
  ];
  return (
    <div aria-hidden className={cx("pointer-events-none select-none overflow-hidden rounded-2xl border border-rule bg-surface-container-lowest", FRAME)}>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">research-agent</div>
          <div className="money text-[12px] text-outline">0.0.5821094</div>
        </div>
        <div className="flex gap-0.5 rounded-[10px] border border-rule bg-surface-container-low p-0.5 text-[13px]">
          <span className="rounded-lg bg-surface-container-lowest px-3 py-1 font-medium shadow-[0_1px_2px_rgb(16_16_20/0.08)]">Limits</span>
          <span className="px-3 py-1 text-on-surface-variant">Merchants</span>
          <span className="hidden px-3 py-1 text-on-surface-variant sm:inline">Connect</span>
        </div>
      </div>
      <div className="divide-y divide-rule px-5 sm:px-6">
        {limits.map(([label, hint, v, unit]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[13px] text-on-surface-variant">{hint}</div>
            </div>
            <div className="money flex h-9 w-28 shrink-0 items-center justify-end gap-1.5 rounded-lg border border-rule-strong bg-surface-container-lowest px-3 text-sm shadow-[0_1px_2px_rgb(16_16_20/0.04)] sm:w-32">
              {v}{unit && <span className="text-xs text-outline">{unit}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-rule bg-surface-container-low/70 px-5 pb-2 pt-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Only pay merchants I pick</div>
            <div className="text-[13px] text-on-surface-variant">2 picked</div>
          </div>
          <StillSwitch on />
        </div>
        <ul className="mt-2 divide-y divide-rule">
          {picks.map(([n, meta, on]) => (
            <li key={n} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{n}</div>
                <div className="money text-[12px] text-on-surface-variant">{meta}</div>
              </div>
              <StillSwitch on={on} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const FRAME = "shadow-[0_1px_2px_rgb(16_16_20/0.05),0_16px_40px_-24px_rgb(16_16_20/0.2)]";

/** Looks like the kit Switch, does nothing. */
function StillSwitch({ on }: { on: boolean }) {
  return (
    <span className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full", on ? "bg-on-surface" : "bg-surface-container-highest")}>
      <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(16_16_20/0.2)]", on ? "translate-x-[18px]" : "translate-x-0.5")} />
    </span>
  );
}

/* ------------------------------------------------------------- bond */
export function Bond({ price, penalty, penaltyBps, merchant }: { price: number; penalty: number; penaltyBps: number; merchant?: PublicMerchant }) {
  const slash = price + penalty;
  const bond = Number(merchant?.bondAvailable ?? 0);
  const covers = slash > 0 ? Math.floor(bond / slash) : 0;
  const segs = Math.max(6, Math.min(12, covers || 10));
  const slug = merchant?.slug ?? "skycast";
  const refunded: [string, string][] = [
    ["Server errors", "The API answers with an error status or drops the connection."],
    ["Timeouts", "No answer inside the merchant's time limit, at most 30 seconds."],
    ["Bad data", "An empty body, or JSON that doesn't match the merchant's published schema."],
  ];
  return (
    <section className={cx(WRAP, SECTION, "grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16")} aria-labelledby="bond-h">
      <figure className="min-w-0 lg:col-span-7">
        <div aria-hidden className={cx("overflow-hidden rounded-2xl border border-rule bg-surface-container-lowest", FRAME)}>
          <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3.5 font-mono text-[12.5px] sm:px-6">
            <span className="min-w-0 truncate text-on-surface-variant">POST /v1/call/{slug}</span>
            <span className="shrink-0 text-bad">500 Internal Server Error</span>
          </div>
          <div className="px-5 py-6 sm:px-6 sm:py-7">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-on-surface-variant">{merchant ? `${merchant.name}'s bond` : "Merchant bond"}</span>
              <span className="money font-medium">{merchant ? `${usdc(bond)}${NBSP}USDC` : ""}</span>
            </div>
            <div className="mt-3 flex h-9 gap-1">
              {Array.from({ length: segs }, (_, i) => {
                const last = i === segs - 1;
                return (
                  <span key={i} className={cx("relative flex-1 rounded-md",
                    last ? "border border-bad/50 bg-bad-subtle" : "bg-surface-container-high")}>
                    {last && <span className="absolute inset-0 rounded-md bg-[repeating-linear-gradient(135deg,var(--color-bad)_0_1.5px,transparent_1.5px_6px)] opacity-60" />}
                  </span>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[12px] text-outline">
              <span>Each segment covers one failed call</span>
              <span className="text-bad">This call</span>
            </div>
            <dl className="mt-6 divide-y divide-rule border-y border-rule text-sm">
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-on-surface-variant">Price of the call</dt><dd className="money">{usdc(price)}{NBSP}USDC</dd></div>
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-on-surface-variant">Penalty, {penaltyBps / 100}% of the price</dt><dd className="money">{usdc(penalty)}{NBSP}USDC</dd></div>
              <div className="flex items-baseline justify-between gap-3 py-2.5"><dt className="text-on-surface-variant">Taken from the bond</dt><dd className="money text-bad">{usdc(slash)}{NBSP}USDC</dd></div>
            </dl>
            <p className="money mt-5 text-[17px] font-medium text-gain">+{usdc(price)}{NBSP}USDC back to the agent</p>
            <p className="mt-0.5 text-[13px] text-on-surface-variant">In one Hedera transfer, with a receipt anyone can check.</p>
          </div>
        </div>
        <figcaption className="sr-only">
          A call to {merchant?.name ?? "a merchant"} returned HTTP 500. {usdc(slash)} USDC was taken from its bond, and {usdc(price)} USDC went back to the agent.
        </figcaption>
      </figure>

      <div className="min-w-0 lg:col-span-5 lg:pl-4">
        <p className={EYEBROW}>Bonds</p>
        <h2 id="bond-h" className={H2}>Merchants post a bond. Failures come out of it.</h2>
        <p className={cx(LEAD, "mt-5 max-w-[42ch]")}>
          A merchant locks USDC before it can take payments. When a call fails a check, your agent gets the price back and the merchant pays a {penaltyBps / 100}% penalty.
        </p>
        <dl className="mt-8 max-w-[44ch] divide-y divide-rule border-y border-rule">
          {refunded.map(([k, v]) => (
            <div key={k} className="py-3.5">
              <dt className="text-[15px] font-medium">{k}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed text-on-surface-variant">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[15px]"><Link href="/onboarding?want=merchant" className={LINK}>List your API as a merchant</Link></p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- developers */
export function Developers({ slug }: { slug: string }) {
  const ts = [
    `import { x402Client } from "@x402/core/client";`,
    `import { wrapFetchWithPayment } from "@x402/fetch";`,
    `import { ExactHederaScheme } from "@x402/hedera/exact/client";`,
    `import { createClientHederaSigner } from "@x402/hedera";`,
    ``,
    `const signer = createClientHederaSigner(AGENT_ID, agentKey, {`,
    `  network: "hedera:testnet",`,
    `});`,
    `const pay = wrapFetchWithPayment(fetch, x402Client.fromConfig({`,
    `  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],`,
    `}));`,
    ``,
    `// 200 is the data. 502 means the refund is already on its way.`,
    `const res = await pay("${GATEWAY_URL}/v1/call/${slug}", {`,
    `  method: "POST", headers: { "x-agent-key": AGENT_KEY }, body: "{}",`,
    `});`,
  ].join("\n");
  const mcp = JSON.stringify({
    mcpServers: {
      chowkidaar: {
        command: "npx",
        args: ["-y", "tsx", "<path-to-Chowkidaar>/packages/mcp/src/index.ts"],
        env: { CHOWKIDAAR_URL: GATEWAY_URL, CHOWKIDAAR_AGENT_KEY: "<your agent's API key>" },
      },
    },
  }, null, 2);
  const files: EditorFile[] = [
    { id: "ts", name: "agent.ts", lang: "ts", code: ts, mark: (l) => l.includes("/v1/call/") },
    { id: "mcp", name: "claude_desktop_config.json", lang: "json", code: mcp, mark: (l) => l.includes("CHOWKIDAAR_AGENT_KEY") },
  ];

  return (
    <section className={cx(WRAP, SECTION, "grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16")} aria-labelledby="dev-h">
      <div className="min-w-0 lg:col-span-4">
        <p className={EYEBROW}>Developers</p>
        <h2 id="dev-h" className={H2}>Works with any x402 client</h2>
        <p className={cx(LEAD, "mt-5 max-w-[40ch]")}>
          Point your client at the gateway and send your agent&apos;s key. The merchant&apos;s API doesn&apos;t change.
        </p>
        <div className="mt-8 flex flex-col gap-3 text-[15px]">
          <a href={DOCS} target="_blank" rel="noreferrer" className={cx(LINK, "self-start")}>Read the API docs</a>
          <a href={REPO} target="_blank" rel="noreferrer" className={cx(LINK, "self-start")}>Read the source on GitHub</a>
        </div>
      </div>
      <div className="min-w-0 lg:col-span-8">
        <CodeEditor files={files} label="Code sample" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- FAQ */
export function Faq({ feeBps, penaltyBps }: { feeBps: number; penaltyBps: number }) {
  const qs: [string, string][] = [
    ["What happens if a merchant fails?",
      `If the call errors, times out or returns bad data, your agent gets the price back from the merchant's bond in one Hedera transfer. The merchant also pays a penalty of ${penaltyBps / 100}% of the price from its bond.`],
    ["Who holds the money?",
      "Each agent pays from its own Hedera account. If Chowkidaar creates the wallet, the gateway keeps its key; you can also bring your own account. Merchant bonds sit in a vault account the gateway runs."],
    ["What does it cost?",
      `${feeBps / 100}% per call, on top of the merchant's price. If a call fails because of our error, the fee is refunded too.`],
    ["Do I need crypto?",
      "No. Chowkidaar runs on Hedera testnet with test USDC. Create an agent, we make its wallet, and you can add test USDC from the agent's page."],
    ["Can I use it with Claude, ChatGPT or Cursor?",
      "Yes. The Chowkidaar MCP server gives any MCP client tools to ask for a service, list merchants, check the wallet and read receipts, all inside the limits you set."],
  ];
  return (
    <section className={cx(WRAP, SECTION, "grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16")} aria-labelledby="faq-h">
      <div className="lg:col-span-4">
        <p className={EYEBROW}>Questions</p>
        <h2 id="faq-h" className={H2}>Good to know</h2>
        <p className="mt-5 text-[15px] text-on-surface-variant">
          Something else? <a href={DOCS} target="_blank" rel="noreferrer" className={LINK}>Read the docs</a>.
        </p>
      </div>
      <div className="border-t border-rule lg:col-span-8">
        {qs.map(([q, a]) => (
          <details key={q} className="group border-b border-rule">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-lg py-5 text-[17px] font-medium transition-colors hover:text-on-surface-variant [&::-webkit-details-marker]:hidden">
              {q}
              <Plus aria-hidden className="h-4 w-4 shrink-0 text-outline transition-transform duration-200 group-open:rotate-45" />
            </summary>
            <p className="-mt-1 max-w-[62ch] pb-6 pr-10 text-[15px] leading-relaxed text-on-surface-variant">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ close */
export function Close() {
  return (
    <section className={cx(WRAP, "pb-24 pt-8 sm:pb-32")} aria-labelledby="close-h">
      <div className="flex flex-col items-center rounded-3xl border border-rule bg-surface-container-lowest px-6 py-16 text-center shadow-[0_1px_2px_rgb(16_16_20/0.04)] sm:py-20">
        <h2 id="close-h" className="max-w-[16ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">Give your first agent a budget</h2>
        <p className={cx(LEAD, "mt-4 max-w-[40ch]")}>Sign in with World ID and set its limits. It can pay for its first call in a few minutes.</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <StartCta className="h-11 px-5 text-[15px]" />
        </div>
      </div>
    </section>
  );
}
