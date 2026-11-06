"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Bot, Check, ChevronDown, CornerDownLeft, Loader2, Minus, Receipt as ReceiptIcon, ShieldCheck, X } from "lucide-react";
import { POLICY_ERROR_LABEL, REASON_LABEL, SKIP_REASON, type PublicMerchant, type Receipt } from "@app/shared";
import { ApiError, get, post, type AgentRow, type ApprovalRow, type AuthConfig } from "@/lib/api";
import { TxLink, cx } from "@/lib/ui";
import { LoadError, Meter, PageHeader, ago, useApprovals, usdc } from "@/components/owner/kit";
import { WalletPanel } from "@/components/WalletPanel";
import { ErrorCard, TechDetails } from "@/components/RunView";
import { Logo } from "@/components/Logo";


type Cand = { id: string; slug: string; name: string; category: string; price: string; total: string; score: number | null; matched: string[]; eligible: boolean; why: string[] };
type Ask = {
  outcome: "delivered" | "refund_pending" | "held" | "blocked" | "error" | "no_merchant";
  intent: { words: string[]; categories: string[] };
  scoreSource: "arkiv" | "gateway"; candidates: Cand[]; merchant: Cand | null;
  status: number | null; body: Record<string, unknown> | null; agentTx: string | null; error?: string;
};
type Msg = { id: number; role: "user"; text: string; at: number } | { id: number; role: "agent"; query: string; ask: Ask; at: number };
/** One request and what came of it. A retry after approval opens its own run. */
type Run = { id: number; query: string; at: number; result?: Extract<Msg, { role: "agent" }>; afterApproval?: boolean };
type Retry = { approvalId: string; slug: string };
type AskVars = { agentId: string; query: string; retry?: Retry };

const PANEL_TITLE = "font-display text-xl font-semibold tracking-[-0.01em]";

export default function ConsolePage() {
  const qc = useQueryClient();
  const reduceMotion = useReducedMotion();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents"), retry: false, refetchInterval: 8000 });
  const auth = useQuery({ queryKey: ["auth-config"], queryFn: () => get<AuthConfig>("/api/auth/config"), staleTime: 60_000 });
  const catalog = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants"), refetchInterval: 15_000 });
  const custodial = agents.data?.filter((a) => a.custodial) ?? [];
  const [agentId, setAgentId] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [undo, setUndo] = useState<{ msgs: Msg[]; agentId: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!agentId && custodial[0]) setAgentId(custodial[0].id); }, [custodial, agentId]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const agent = custodial.find((a) => a.id === agentId);
  // What the merchants themselves suggest asking for; the ones this agent may pay come first.
  const suggestions = [...new Map((catalog.data ?? [])
    .filter((m) => m.samplePrompt && m.covered)
    .sort((x, y) => Number(agent?.allowedMerchantIds.includes(y.id) ?? 0) - Number(agent?.allowedMerchantIds.includes(x.id) ?? 0))
    .map((m) => [m.samplePrompt!, m] as const)).values()].slice(0, 4);

  const ask = useMutation({
    mutationFn: ({ agentId: id, query, retry }: AskVars) => post<Ask>(`/api/agents/${id}/ask`, { query, approvalId: retry?.approvalId, slug: retry?.slug }),
    onSuccess: (r, { query }) => {
      setMsgs((m) => [...m, { id: ++seq.current, role: "agent", query, ask: r, at: Date.now() }]);
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
    // Nothing is lost on failure: the words go back in the box (unless something new was typed).
    onError: (_e, { query, retry }) => { if (!retry) setText((t) => t || query); },
  });
  const send = (query: string, retry?: Retry) => {
    const q = query.trim();
    if (!q || !agentId || ask.isPending) return;
    if (!retry) setMsgs((m) => [...m, { id: ++seq.current, role: "user", text: q, at: Date.now() }]);
    if (!retry && text.trim() === q) setText("");
    setUndo(null);
    ask.mutate({ agentId, query: q, retry });
  };

  /** Clearing (or switching agent) empties the session, with five seconds to take it back. */
  const clear = (nextAgentId = agentId) => {
    if (msgs.length > 0) {
      setUndo({ msgs, agentId });
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    }
    setMsgs([]);
    ask.reset();
    setAgentId(nextAgentId);
  };
  const restore = () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setMsgs(undo.msgs);
    setAgentId(undo.agentId);
    setUndo(null);
  };

  // Keep the newest run in view, scrolling the session only (not the page).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [msgs.length, ask.isPending, ask.isError, reduceMotion]);

  if (agents.error instanceof ApiError && agents.error.status === 401 && !agents.data) {
    return (
      <Gate title="Sign in to use the console" body="The console pays from your agent's wallet, so it needs to know whose agents to show.">
        <Link className="btn-primary" href="/login">Sign in</Link>
      </Gate>
    );
  }
  if (agents.isError && !agents.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <PageHeader title="Console" />
        <LoadError what="your agents" retry={() => agents.refetch()} />
      </div>
    );
  }
  if (agents.data && custodial.length === 0) {
    return (
      <Gate title="Create an agent to pay for you" body="The console pays from a wallet we hold for your agent. Create an agent, choose “Create one for me” as its wallet, and come back here.">
        <Link href="/owner/agents/new" className="btn-primary">Create an agent</Link>
      </Gate>
    );
  }

  const agentPass = auth.data?.agentPass === true;
  const results = msgs.filter((m): m is Extract<Msg, { role: "agent" }> => m.role === "agent");
  const runs: Run[] = [];
  for (const m of msgs) {
    const last = runs.at(-1);
    if (m.role === "user") runs.push({ id: m.id, query: m.text, at: m.at });
    else if (last && !last.result && last.query === m.query) last.result = m;
    else runs.push({ id: m.id, query: m.query, at: m.at, result: m, afterApproval: true });
  }
  const open = runs.at(-1) && !runs.at(-1)!.result ? runs.at(-1)!.id : null;

  // The session ledger: what this conversation has cost, and what came back.
  const spent = results.reduce((t, r) => t + (r.ask.outcome === "delivered" || r.ask.outcome === "refund_pending" ? Number(r.ask.merchant?.total ?? 0) : 0), 0);
  const back = results.reduce((t, r) => t + (r.ask.outcome === "refund_pending" ? Number((r.ask.body ?? {}).refundAmount ?? 0) : 0), 0);

  return (
    // A full-height workspace under the nav: the conversation owns the page, the agent sits in a side rail.
    <div className="flex h-[calc(100dvh-4rem)] min-h-[560px]">
      <section aria-labelledby="session-title" className="relative flex min-w-0 flex-1 flex-col">
        {/* Session bar: what this conversation has cost so far. Flat, no frame. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <h1 id="session-title" className="text-sm font-medium">Console</h1>
            <span className="h-4 w-px bg-rule" aria-hidden />
            {runs.length > 0 ? (
              <p className="money truncate text-sm text-on-surface-variant">
                {runs.length} {runs.length === 1 ? "request" : "requests"}<span className="text-outline"> / </span>{usdc(spent)} USDC spent
                {back > 0 && <><span className="text-outline"> / </span><span className="text-gain">+{usdc(back)} back</span></>}
              </p>
            ) : <p className="truncate text-sm text-on-surface-variant">{agent ? `Paying from ${agent.name}` : "Loading your agents…"}</p>}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {custodial.length > 0 && <AgentPicker agents={custodial} value={agentId} onChange={clear} disabled={ask.isPending} className="max-w-[180px] lg:hidden" />}
            {msgs.length > 0 && <button type="button" className="btn-ghost min-h-9 py-1.5" onClick={() => clear()} disabled={ask.isPending}>New session</button>}
          </div>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col px-4 pb-44 pt-4 sm:px-6">
            {runs.length === 0 && !ask.isPending ? (
              <Welcome agent={agent} suggestions={suggestions} busy={!agentId || ask.isPending} onPick={(q) => send(q)} loading={!catalog.data} />
            ) : (
              <ol aria-label="Requests" className="space-y-5">
                <AnimatePresence initial={false}>
                  {runs.map((r) => (
                    <motion.li key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
                      <RunCard run={r} agent={agent} agentPass={agentPass} busy={ask.isPending}
                        pending={r.id === open && ask.isPending}
                        error={r.id === open && ask.isError ? ask.error : null}
                        onResend={() => { if (ask.variables) { const v = ask.variables; if (!v.retry && text.trim() === v.query) setText(""); ask.mutate(v); } }}
                        onRetry={(retry) => send(r.query, retry)} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            )}

            {/* Screen readers hear one line per result, not the whole card. */}
            <ol role="log" aria-relevant="additions" className="sr-only">
              {results.map((m) => <li key={m.id}>{summarise(m.ask)}</li>)}
            </ol>
          </div>
        </div>

        {/* Command bar floats over the end of the session, with the page fading out beneath it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface from-60% to-transparent pt-16">
          <form className="pointer-events-auto mx-auto w-full max-w-[860px] px-4 pb-4 sm:px-6 sm:pb-6" aria-busy={ask.isPending} onSubmit={(e) => { e.preventDefault(); send(text); }}>
            {undo && (
              <div role="status" className="mb-2 flex items-center justify-between gap-3 rounded-full bg-surface-container px-4 py-1 text-sm text-on-surface-variant">
                <span>Session cleared.</span>
                <button type="button" className="btn-ghost min-h-9 py-1 text-on-surface" onClick={restore}>Undo</button>
              </div>
            )}
            {runs.length > 0 && suggestions.length > 0 && (
              <div className="-mx-1 mb-2.5 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                {suggestions.map((m) => <PromptPill key={m.id} text={m.samplePrompt!} onClick={() => send(m.samplePrompt!)} disabled={!agentId || ask.isPending} />)}
              </div>
            )}
            <div className="flex items-center gap-2 rounded-[22px] border border-rule-strong bg-surface-container-low py-2 pl-4 pr-2 shadow-[0_8px_30px_-12px_rgb(16_16_20/0.18)] transition-[border-color,box-shadow] duration-150 has-[input:focus-visible]:border-field has-[input:focus-visible]:shadow-[0_0_0_4px_rgb(17_17_20/0.08),0_8px_30px_-12px_rgb(16_16_20/0.18)]">
              <Logo className="h-6 w-6 shrink-0" />
              <label htmlFor="console-ask" className="sr-only">Ask your agent</label>
              {/* The focus treatment is drawn on the whole bar, not on the bare input inside it. */}
              <input ref={input} id="console-ask" style={{ outline: "none" }} className="min-w-0 flex-1 bg-transparent py-2 text-base text-on-surface placeholder:text-outline sm:text-[15px]"
                placeholder={agent ? `What should ${agent.name} get?` : "What should your agent get?"} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" enterKeyHint="send" />
              <span className="hidden items-center gap-1 text-xs text-outline md:flex" aria-hidden><CornerDownLeft className="h-3.5 w-3.5" /> to pay</span>
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-on-primary transition-[background-color,scale] duration-150 hover:bg-primary-hover enabled:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={ask.isPending || !text.trim() || !agentId} aria-label={ask.isPending ? "Paying" : "Send"}>
                {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
                <span className="hidden sm:inline">{ask.isPending ? "Paying…" : "Send"}</span>
              </button>
            </div>
            {agent && (
              <p className="money mt-2 px-2 text-center text-xs text-outline">
                Up to {usdc(agent.perCallCap)} USDC a request, {usdc(Math.max(0, agent.dailyCap - agent.spentToday))} USDC left today. Above {usdc(agent.approvalThreshold)} USDC it asks you first.
              </p>
            )}
          </form>
        </div>
      </section>

      {/* Agent rail: flat, full height, one hairline from the conversation. */}
      <aside aria-label="Agent" className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-rule lg:flex xl:w-[360px]">
        <div className="space-y-6 p-6">
          <div className="flex items-center justify-between gap-3">
            {custodial.length > 0 ? <AgentPicker agents={custodial} value={agentId} onChange={clear} disabled={ask.isPending} className="min-w-0 flex-1" /> : <div className="skeleton h-11 flex-1 rounded-full" />}
            {agent?.status === "paused" && <span className="pill pill-warn">Paused</span>}
          </div>
          {agent ? <WalletPanel agentId={agent.id} accountId={agent.hederaAccountId} custodial compact /> : <div className="skeleton h-28" />}
        </div>

        {agent && (
          <div className="space-y-5 border-t border-rule p-6">
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-on-surface-variant">Today</span>
                <span className="money"><span className="font-medium text-on-surface">{usdc(agent.spentToday)}</span> <span className="text-on-surface-variant">of {usdc(agent.dailyCap)}&nbsp;USDC</span></span>
              </div>
              <Meter used={agent.spentToday} cap={agent.dailyCap} className="mt-2.5" />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Limit k="Per request">{usdc(agent.perCallCap)}<span className="text-xs font-normal text-on-surface-variant"> USDC</span></Limit>
              <Limit k="Asks you above">{usdc(agent.approvalThreshold)}<span className="text-xs font-normal text-on-surface-variant"> USDC</span></Limit>
              <Limit k="Minimum score">{agent.minScore}</Limit>
              <Limit k="Can pay">{agent.allowlistOnly ? `${agent.allowedMerchantIds.length} picked` : "Any merchant"}</Limit>
            </dl>
            <Link className="btn-secondary w-full" href={`/owner/agents/${agent.id}?tab=limits`}>Edit limits</Link>
          </div>
        )}

        <details className="group mt-auto border-t border-rule px-6 py-4">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden">
            How your agent chooses <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <HowItChooses className="mt-1 text-xs" />
        </details>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** First screen of a session: what to ask, built from what merchants actually sell. */
function Welcome({ agent, suggestions, busy, onPick, loading }: { agent?: AgentRow; suggestions: PublicMerchant[]; busy: boolean; onPick: (q: string) => void; loading: boolean }) {
  return (
    <div className="flex flex-1 flex-col justify-center py-8">
      <div className="mx-auto w-full max-w-2xl">
        <Logo className="h-11 w-11" />
        <h2 className="mt-6 font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]">What should {agent?.name ?? "your agent"} get you?</h2>
        <p className="mt-3 max-w-[56ch] text-[15px] text-on-surface-variant">Ask in plain words. It picks a merchant it may pay, pays on Hedera with real testnet USDC inside your limits, and brings back the answer. If a merchant fails, the money comes back.</p>
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
          {loading ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[74px]" />) : suggestions.map((m) => (
            <button key={m.id} type="button" disabled={busy} onClick={() => onPick(m.samplePrompt!)}
              className="group flex flex-col items-start gap-1 rounded-2xl bg-surface-container-low p-4 text-left ring-1 ring-inset ring-transparent transition-[background-color,box-shadow,scale] duration-150 hover:bg-surface-container hover:ring-rule-strong enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55">
              <span className="text-[15px] text-on-surface">&ldquo;{m.samplePrompt}&rdquo;</span>
              <span className="money text-xs text-on-surface-variant">{m.name}, {usdc(m.price)} USDC</span>
            </button>
          ))}
        </div>
        {!loading && suggestions.length === 0 && <p className="mt-4 text-sm text-on-surface-variant">No merchant has posted an example yet. Ask for anything in plain words.</p>}
      </div>
    </div>
  );
}

function HowItChooses({ className }: { className?: string }) {
  return (
    <p className={cx("leading-relaxed text-on-surface-variant", className)}>
      Among merchants it may pay, whose bond covers the call and whose price is within its per-request limit, it takes the one with the highest score on Arkiv.
      If the merchant fails any objective check, the refund happens automatically.
    </p>
  );
}

/** One sentence per result, for the screen-reader log. */
function summarise(a: Ask) {
  const m = a.merchant;
  const body = a.body ?? {};
  switch (a.outcome) {
    case "delivered": return `Delivered by ${m?.name ?? "the merchant"} for ${usdc(m?.total)} USDC.`;
    case "refund_pending": return `${m?.name ?? "The merchant"} failed. ${usdc(String(body.refundAmount ?? "0"))} USDC is coming back to you.`;
    case "held": return `Needs your approval to pay ${m?.name ?? "the merchant"} ${usdc(m?.total)} USDC. Nothing paid yet.`;
    case "blocked": return `Blocked before payment: ${POLICY_ERROR_LABEL[String(body.error)] ?? "a limit you set"}. No money moved.`;
    case "no_merchant": return "No merchant your agent may pay can take this. Nothing was paid.";
    default: return "The call stopped before it finished.";
  }
}

function Gate({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-on-surface-variant" aria-hidden><Bot className="h-5 w-5" /></span>
      <h1 className="mt-6 font-display text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-3 text-sm text-on-surface-variant">{body}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function AgentPicker({ agents, value, onChange, disabled, className }: { agents: AgentRow[]; value: string; onChange: (id: string) => void; disabled?: boolean; className?: string }) {
  const current = agents.find((a) => a.id === value);
  return (
    <label className={cx("relative inline-flex min-w-0 items-center", className)}>
      <span className="sr-only">Agent</span>
      <span className="pointer-events-none absolute left-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-highest text-sm font-semibold text-on-surface-variant" aria-hidden>
        {(current?.name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-surface-container pl-12 pr-10 text-base font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-55 sm:text-sm">
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === "paused" ? " (paused)" : ""}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 h-4 w-4 text-on-surface-variant" aria-hidden />
    </label>
  );
}

function PromptPill({ text, onClick, disabled }: { text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-9 shrink-0 whitespace-nowrap rounded-full border border-rule-strong px-3.5 py-1.5 text-left text-[13px] text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-55">
      {text}
    </button>
  );
}

function Limit({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-on-surface-variant">{k}</dt>
      <dd className="money mt-1 text-[17px] font-semibold">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ a run: the request and what happened */

const useReceipt = (paymentId: string | null, enabled: boolean) => useQuery({
  queryKey: ["receipt", paymentId], queryFn: () => get<Receipt>(`/api/public/receipts/${paymentId}`), enabled: enabled && Boolean(paymentId),
  refetchInterval: (q) => (q.state.data && ["refunded", "refund_failed"].includes(q.state.data.status) && q.state.data.hcs.sequence ? false : 1500),
});

/*
 * The card is 24px round with 20px padding; wells inside are 8px round. The step spine mirrors the
 * guarded payment on the landing page: the same five beats, now with this request's real values.
 */
const WELL = "rounded-lg";
type StepState = "done" | "fail" | "wait" | "run" | "idle" | "skip";
type Step = { key: string; state: StepState; title: React.ReactNode; detail?: React.ReactNode; aside?: React.ReactNode };

const PENDING_STEPS = ["Understanding the request", "Choosing a merchant it may pay", "Checking your limits", "Paying on Hedera", "Checking the answer"];

/** While the gateway works, the spine fills in at a believable pace; the real result replaces it. */
function useTicker(active: boolean, count: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const t = setInterval(() => setI((n) => Math.min(n + 1, count - 1)), 900);
    return () => clearInterval(t);
  }, [active, count]);
  return i;
}

function stepsFor(ask: Ask, refundState: "pending" | "failed" | "done" | null, refund?: Receipt): Step[] {
  const m = ask.merchant;
  const body = ask.body ?? {};
  const understood: Step = {
    key: "intent", state: ask.intent?.categories.length ? "done" : "fail",
    title: ask.intent?.categories.length ? <>Understood as {ask.intent.categories.join(" or ")}</> : "Couldn't tell what this is",
    detail: ask.intent?.words.length ? <>From {ask.intent.words.map((w, i) => <span key={w}>{i > 0 && ", "}<span className="text-on-surface">{w}</span></span>)}</> : undefined,
  };
  if (ask.outcome === "no_merchant" || !m) {
    return [understood, { key: "pick", state: "fail", title: "No merchant it may pay can take this", detail: "Nothing was paid." }];
  }
  const picked: Step = {
    key: "pick", state: "done", title: <>Chose {m.name}</>,
    detail: <>{m.category}, {m.score == null ? "new merchant" : <>score <span className="money">{m.score}</span></>}{ask.scoreSource === "arkiv" ? ", read from Arkiv" : ""}</>,
    aside: <span className="money">{usdc(m.price)}</span>,
  };
  if (ask.outcome === "blocked") {
    return [understood, picked, { key: "limits", state: "fail", title: "Stopped by your limits", detail: <>{POLICY_ERROR_LABEL[String(body.error)] ?? "A limit you set"}. No money moved.</> }];
  }
  if (ask.outcome === "held") {
    return [understood, picked, { key: "limits", state: "wait", title: "Waiting for your approval", detail: "It's above the amount you asked to approve. Nothing paid yet." }];
  }
  const limits: Step = { key: "limits", state: "done", title: "Inside your limits", detail: "Per-request cap, daily budget and merchant score all passed." };
  const paid: Step = {
    key: "paid", state: ask.outcome === "error" && !ask.agentTx ? "fail" : "done",
    title: ask.agentTx ? "Paid on Hedera" : ask.outcome === "error" ? "Payment didn't complete" : "Paid on Hedera",
    detail: ask.agentTx ? <TxLink id={ask.agentTx} label="View transaction" /> : undefined,
    aside: <span className="money">{usdc(m.total)}</span>,
  };
  if (ask.outcome === "delivered") {
    return [understood, picked, limits, paid, { key: "answer", state: "done", title: "Answer delivered", detail: "Valid response that matches the merchant's schema." }];
  }
  if (ask.outcome === "refund_pending") {
    return [understood, picked, limits, paid,
      { key: "answer", state: "fail", title: <>{m.name} failed</>, detail: REASON_LABEL[String(body.reason)] ?? "It didn't pass the checks." },
      {
        key: "refund", state: refundState === "done" ? "done" : refundState === "failed" ? "fail" : "run",
        title: refundState === "done" ? "Refunded" : refundState === "failed" ? "Refund failed" : "Refunding from the bond",
        detail: refundState === "done" && refund?.links.refund ? <TxLink href={refund.links.refund} label="Refund transaction" /> : refundState === "failed" ? "Flagged on your dashboard for a retry." : "One Hedera transfer, usually a few seconds.",
        aside: <span className="money text-gain">+{usdc(String(body.refundAmount ?? "0"))}</span>,
      }];
  }
  return [understood, picked, limits, paid];
}

function Spine({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-3.5 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className={cx("absolute left-[11px] top-6 bottom-0 w-px", s.state === "done" ? "bg-ok/40" : "bg-rule")} />}
          <StepDot state={s.state} />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cx("text-sm", s.state === "idle" || s.state === "skip" ? "text-outline" : s.state === "fail" ? "font-medium text-bad" : "font-medium text-on-surface")}>{s.title}</span>
              {s.aside && <span className="shrink-0 text-sm">{s.aside}</span>}
            </div>
            {s.detail && <div className="mt-0.5 text-xs text-on-surface-variant">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepDot({ state }: { state: StepState }) {
  const base = "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
  if (state === "done") return <span className={cx(base, "bg-ok-subtle text-ok")} aria-label="Done"><Check className="h-3.5 w-3.5" /></span>;
  if (state === "fail") return <span className={cx(base, "bg-bad-subtle text-bad")} aria-label="Failed"><X className="h-3.5 w-3.5" /></span>;
  if (state === "wait") return <span className={cx(base, "bg-warn-subtle text-warn")} aria-label="Waiting"><Minus className="h-3.5 w-3.5" /></span>;
  if (state === "run") return <span className={cx(base, "bg-surface-container-high text-on-surface")} aria-label="In progress"><Loader2 className="h-3.5 w-3.5 animate-spin" /></span>;
  return <span className={cx(base, "bg-surface-container text-outline")} aria-label="Not yet"><span className="h-1.5 w-1.5 rounded-full bg-current" /></span>;
}

function RunCard({ run, agent, agentPass, busy, pending, error, onResend, onRetry }: {
  run: Run; agent?: AgentRow; agentPass: boolean; busy: boolean; pending: boolean; error: unknown; onResend: () => void; onRetry: (r: Retry) => void;
}) {
  const ask = run.result?.ask;
  const m = ask?.merchant;
  const body = ask?.body ?? {};
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : null;
  const refund = useReceipt(paymentId, ask?.outcome === "refund_pending").data;
  const refundState = ask?.outcome !== "refund_pending" ? null : !refund || refund.status === "refund_pending" ? "pending" : refund.status === "refund_failed" ? "failed" : "done";
  const tick = useTicker(pending, PENDING_STEPS.length);

  const [label, pill] = !ask ? (pending ? ["Working", "pill-muted"] : error ? ["Didn't send", "pill-bad"] : ["Not sent", "pill-muted"])
    : ask.outcome === "delivered" ? ["Delivered", "pill-ok"]
    : ask.outcome === "refund_pending" ? (refundState === "done" ? ["Refunded", "pill-info"] : refundState === "failed" ? ["Refund failed", "pill-bad"] : ["Refunding", "pill-warn"])
    : ask.outcome === "held" ? ["Needs your approval", "pill-warn"]
    : ask.outcome === "blocked" ? ["Blocked", "pill-muted"]
    : ask.outcome === "no_merchant" ? ["No match", "pill-muted"]
    : ["Didn't finish", "pill-bad"];

  const steps: Step[] = ask ? stepsFor(ask, refundState, refund)
    : PENDING_STEPS.map((t, i) => ({ key: t, title: t, state: (pending ? (i < tick ? "done" : i === tick ? "run" : "idle") : "skip") as StepState }));

  return (
    <article aria-label={`Request: ${run.query}`} aria-busy={pending}
      className={cx("rounded-[24px] bg-surface-container-low p-5 transition-shadow duration-300",
        pending ? "shadow-[inset_0_0_0_1px_rgb(17_17_20/0.18),0_8px_24px_-12px_rgb(16_16_20/0.18)]" : "shadow-[0_1px_2px_rgb(16_16_20/0.04)]")}>
      {/* The request itself, set like a headline: this is what the money is for. */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs text-outline">{run.afterApproval ? "Paid after your approval" : "You asked"}<span aria-hidden> &middot; </span>{ago(run.at).toLowerCase()}</p>
          <p className="mt-1 break-words font-display text-lg font-medium leading-snug tracking-[-0.01em]">&ldquo;{run.query}&rdquo;</p>
        </div>
        <span className={cx("pill", pill)}>{label}</span>
      </header>

      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Spine steps={steps} />

        {/* The result column: what you got, or what happens next. */}
        <div className="min-w-0 space-y-3">
          {!ask && pending && (
            <div className={cx("flex h-full min-h-24 flex-col justify-center gap-2 bg-surface-container px-4 py-3", WELL)}>
              <span className="text-sm text-on-surface-variant">{agent ? `${agent.name} is paying from its wallet.` : "Your agent is paying."}</span>
              <span className="text-xs text-outline">Nothing leaves the wallet unless every check passes.</span>
            </div>
          )}
          {!ask && !!error && <ErrorCard className="min-w-0" error={error} retryLabel="Send again" onRetry={onResend} />}

          {ask?.outcome === "delivered" && (
            <div className={cx("overflow-hidden bg-surface-container", WELL)}>
              <div className="flex items-center justify-between gap-3 border-b border-rule px-3 py-2">
                <span className="text-xs text-on-surface-variant">What {m?.name ?? "the merchant"} returned</span>
                <span className="money text-xs text-on-surface-variant">{usdc(m?.total)} USDC</span>
              </div>
              <div className="max-h-56 overflow-y-auto px-3 py-3"><DataView data={body.data} /></div>
            </div>
          )}

          {ask?.outcome === "refund_pending" && (
            <div className={cx("space-y-2 bg-surface-container px-4 py-3 text-sm leading-relaxed", WELL)}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-on-surface-variant">{refundState === "done" ? "Back in your wallet" : "Coming back to you"}</span>
                <span className="money font-display text-2xl font-semibold text-gain">+{usdc(String(body.refundAmount ?? "0"))}</span>
              </div>
              <p className="text-xs text-on-surface-variant">
                {body.faultCase === "A" ? "Paid from the merchant's bond, and the merchant is penalised on top." : body.faultCase === "B" ? "The gateway refunds you: the merchant failed before it was paid." : "A full refund: this one was our fault."}
              </p>
              <RefundLine state={refundState} receipt={refund} />
              {body.detail ? <TechDetails>{String(body.detail)}</TechDetails> : null}
            </div>
          )}

          {ask?.outcome === "held" && m && <Held approvalId={String(body.approvalId)} merchant={m} agent={agent} agentPass={agentPass} busy={busy} onRetry={onRetry} />}

          {ask?.outcome === "blocked" && (
            <div className={cx("space-y-3 bg-surface-container px-4 py-3 text-sm text-on-surface-variant", WELL)}>
              <p>Your limits stopped this before any payment. Change them if this should go through.</p>
              {agent && <Link className="btn-secondary" href={`/owner/agents/${agent.id}?tab=limits`}>Edit limits</Link>}
            </div>
          )}

          {ask?.outcome === "no_merchant" && (
            <div className={cx("space-y-3 bg-surface-container px-4 py-3 text-sm text-on-surface-variant", WELL)}>
              <p>{ask.intent?.words.length ? "No merchant this agent may pay sells that right now." : "No merchant sells that, as far as they have told us."}</p>
              {ask.candidates.length > 0 && <Candidates ask={ask} />}
              {agent && <Link className="btn-secondary" href={`/owner/agents/${agent.id}?tab=merchants`}>Change what it may pay</Link>}
            </div>
          )}

          {ask?.outcome === "error" && (
            <div className={cx("space-y-1 bg-bad-subtle px-4 py-3 text-sm", WELL)}>
              <p className="text-bad">The call stopped before it finished. If any money left your wallet, the receipt shows the refund.</p>
              <TechDetails>{ask.error ?? JSON.stringify(ask.body, null, 2)}</TechDetails>
            </div>
          )}

          {paymentId && (
            <Link className="inline-flex min-h-9 items-center gap-1.5 text-sm text-on-surface-variant underline decoration-outline underline-offset-4 transition-colors hover:text-on-surface" href={`/receipts/${paymentId}`}>
              <ReceiptIcon className="h-4 w-4" aria-hidden /> Open receipt
            </Link>
          )}
        </div>
      </div>

      {ask && m && <Why ask={ask} />}
    </article>
  );
}

function RefundLine({ state, receipt: d }: { state: "pending" | "failed" | "done" | null; receipt?: Receipt }) {
  if (state === "pending" || !d) return <div className="flex items-center gap-2 text-xs text-warn"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Refund in progress on Hedera…</div>;
  if (state === "failed") return <div className="text-xs text-bad">The refund failed. It&apos;s flagged on your dashboard for a retry.</div>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="money font-medium text-gain">Refunded {usdc(d.money.refunded)}&nbsp;USDC</span>
      {d.links.refund && <TxLink href={d.links.refund} label="Refund transaction" />}
      {Number(d.money.bondSlashed) > 0 && <span className="money text-on-surface-variant">Merchant bond slashed {usdc(d.money.bondSlashed)}&nbsp;USDC</span>}
      {d.hcs.sequence && d.links.hcs && <TxLink href={d.links.hcs} label={`HCS record #${d.hcs.sequence}`} />}
    </div>
  );
}

const APPROVE_ERROR: Record<string, string> = {
  expired: "This request expired before it was approved. Ask again to get a new one.",
  already_decided: "This request was already decided. Ask again to get a new one.",
  not_found: "This request no longer exists. Ask again to get a new one.",
};

/**
 * A payment held above the approval limit. With World ID the approval happens in another tab, so we
 * watch the approvals list and only offer "Pay now" once this one has actually been approved.
 */
function Held({ approvalId, merchant, agent, agentPass, busy, onRetry }: { approvalId: string; merchant: Cand; agent?: AgentRow; agentPass: boolean; busy: boolean; onRetry: (r: Retry) => void }) {
  const [sent, setSent] = useState(false);
  const pending = useApprovals();
  const approved = useQuery({
    queryKey: ["approvals", "approved"], queryFn: () => get<ApprovalRow[]>("/api/approvals?status=approved"),
    enabled: !sent, refetchInterval: 3000,
  });
  const pay = () => { setSent(true); onRetry({ approvalId, slug: merchant.slug }); };
  const approve = useMutation({ mutationFn: () => post(`/api/approvals/${approvalId}/approve`), onSuccess: pay });

  const isApproved = approved.data?.some((a) => a.id === approvalId) ?? false;
  const isPending = pending.data?.some((a) => a.id === approvalId) ?? false;
  const gone = !sent && Boolean(pending.data) && Boolean(approved.data) && !isApproved && !isPending;
  const approveError = approve.error instanceof ApiError ? APPROVE_ERROR[approve.error.code] : undefined;

  return (
    <div className="space-y-3 rounded-lg bg-warn-subtle px-3 py-3">
      <p className="text-sm leading-relaxed text-on-surface">
        This payment to <span className="font-medium">{merchant.name}</span> is above your approval limit{agent ? ` of ${usdc(agent.approvalThreshold)} USDC` : ""}. Nothing has been paid. Approve it to let your agent pay and fetch the answer.
      </p>
      {sent ? (
        <p role="status" className="text-sm text-on-surface-variant">Paid with your approval. The answer is below.</p>
      ) : gone ? (
        <p role="status" className="text-sm text-on-surface-variant">This request expired or was declined, so nothing was paid. Ask again to get a new one.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {isApproved ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={pay}>Pay {usdc(merchant.total)}&nbsp;USDC now</button>
          ) : agentPass ? (
            <>
              <a className="btn-primary" href={`/api/world/oidc/start?purpose=approval&approvalId=${approvalId}`} target="_blank" rel="noopener">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Approve with World ID<span className="sr-only"> (opens in a new tab)</span>
              </a>
              {/* Unlocks by itself once the approvals list shows this one approved. */}
              <button type="button" className="btn-secondary" disabled>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Waiting for your approval…
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" disabled={approve.isPending || busy} onClick={() => approve.mutate()}>{approve.isPending ? "Approving…" : "Approve and pay"}</button>
          )}
          <Link className="btn-ghost" href="/owner/approvals">Open approvals</Link>
        </div>
      )}
      {isApproved && !sent && <p role="status" className="text-xs text-on-surface-variant">Approved. Your agent can pay this for the next 15 minutes.</p>}
      {approve.isError && <p role="alert" className="text-xs text-bad">{approveError ?? "Couldn't approve this payment. Check your connection and try again."}</p>}
    </div>
  );
}

/** Why the agent picked this merchant: what it understood, and how every candidate compared. */
function Why({ ask }: { ask: Ask }) {
  const m = ask.merchant!;
  return (
    <details className="group border-t border-rule pt-1">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden">
        Why this merchant <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-sm leading-relaxed text-on-surface-variant">
          Understood as <span className="font-medium text-on-surface">{m.category}</span>
          {ask.intent?.words.length ? <> from the words {ask.intent.words.map((w, i) => <span key={w}>{i > 0 && ", "}<span className="rounded-md bg-surface-container px-1.5 py-0.5 text-on-surface">{w}</span></span>)}</> : null}.
          {" "}It picked the highest-scoring merchant it may pay. {ask.scoreSource === "arkiv" ? "Scores were read from Arkiv." : "Scores came from the gateway."}
        </p>
        <Candidates ask={ask} />
      </div>
    </details>
  );
}

/** Every merchant the agent considered, as a hairline list (no well: it sits flat on the card). */
function Candidates({ ask }: { ask: Ask }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {ask.candidates.map((c) => {
        const chosen = c.slug === ask.merchant?.slug;
        return (
          <li key={c.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">{c.name}</span>
                {chosen && <span className="pill bg-surface-container-highest text-on-surface">Chosen</span>}
              </div>
              <div className="mt-0.5 text-xs text-on-surface-variant">
                {chosen ? c.category : c.eligible ? `${c.category}, could pay, lower score` : `${c.category}, skipped: ${c.why.map((w) => SKIP_REASON[w] ?? w).join(", ")}`}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="money text-sm">{usdc(c.price)} <span className="text-xs text-on-surface-variant">USDC</span></div>
              <div className="money text-xs text-on-surface-variant">{c.score == null ? "New" : `Score ${c.score}`}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DataView({ data }: { data: unknown }) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = Object.entries(data as Record<string, unknown>);
    return (
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-5 gap-y-1.5 font-mono text-xs">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-outline">{k}</dt><dd className="break-all text-on-surface">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}
      </dl>
    );
  }
  return <pre className="overflow-x-auto font-mono text-xs text-on-surface">{typeof data === "string" ? data : JSON.stringify(data, null, 2)}</pre>;
}
