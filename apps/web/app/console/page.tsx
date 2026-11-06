"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Send, ShieldCheck, UserRound } from "lucide-react";
import { formatUsdc, hashscanTx, POLICY_ERROR_LABEL, REASON_LABEL, type Receipt } from "@app/shared";
import { get, post, HASHSCAN, type AgentRow, type AuthConfig } from "@/lib/api";
import { Alert, cx } from "@/lib/ui";
import { WalletPanel } from "@/components/WalletPanel";

type Cand = { id: string; slug: string; name: string; price: string; total: string; score: number | null; eligible: boolean; why: string[] };
type Ask = {
  outcome: "delivered" | "refund_pending" | "held" | "blocked" | "error" | "no_merchant";
  scoreSource: "arkiv" | "gateway"; candidates: Cand[]; merchant: Cand | null;
  status: number | null; body: Record<string, unknown> | null; agentTx: string | null; error?: string;
};
type Msg = { id: number; role: "user"; text: string } | { id: number; role: "agent"; query: string; ask: Ask };
type Retry = { approvalId: string; slug: string };

const WHY: Record<string, string> = { not_allowed: "not on the allowlist", not_covered: "bond too low to cover a call", above_cap: "price above the per-call cap", low_score: "score below your minimum" };
const SUGGESTIONS = ["What's the HBAR price right now?", "Give me the latest HBAR/USD quote", "Price check on HBAR, please"];
const usd = (m: string | number) => formatUsdc(m);

export default function ConsolePage() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents"), retry: false, refetchInterval: 8000 });
  const auth = useQuery({ queryKey: ["auth-config"], queryFn: () => get<AuthConfig>("/api/auth/config"), staleTime: 60_000 });
  const custodial = agents.data?.filter((a) => a.custodial) ?? [];
  const [agentId, setAgentId] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const seq = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!agentId && custodial[0]) setAgentId(custodial[0].id); }, [custodial, agentId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);
  const agent = custodial.find((a) => a.id === agentId);

  const ask = useMutation({
    mutationFn: ({ query, retry }: { query: string; retry?: Retry }) => post<Ask>(`/api/agents/${agentId}/ask`, { query, approvalId: retry?.approvalId, slug: retry?.slug }),
    onSuccess: (r, { query }) => setMsgs((m) => [...m, { id: ++seq.current, role: "agent", query, ask: r }]),
  });
  const send = (query: string, retry?: Retry) => {
    const q = query.trim();
    if (!q || !agentId || ask.isPending) return;
    if (!retry) setMsgs((m) => [...m, { id: ++seq.current, role: "user", text: q }]);
    setText("");
    ask.mutate({ query: q, retry });
  };

  if (agents.isError) return <Alert tone="amber">Sign in as an agent owner to use the console. <Link className="underline" href="/login">Sign in</Link></Alert>;
  if (agents.data && custodial.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="font-display text-2xl font-semibold">Agent console</h1>
        <Alert tone="blue">Create an agent with a gateway-created wallet first; that is the agent that will pay for you here.</Alert>
        <Link href="/owner/agents/new" className="btn-primary">Create an agent</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Agent console</h1>
          <p className="text-sm text-on-surface-variant">Ask for something. Your agent picks the best-rated merchant it is allowed to pay, pays it on Hedera, and brings back the answer or your refund.</p>
        </div>
        <select className="input w-auto" value={agentId} onChange={(e) => { setAgentId(e.target.value); setMsgs([]); }}>
          {custodial.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.hederaAccountId}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="card flex min-h-[520px] flex-col p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {msgs.length === 0 && (
              <div className="space-y-3 py-10 text-center text-sm text-on-surface-variant">
                <Bot className="mx-auto h-8 w-8 text-secondary" />
                <div>Every answer here is paid for with real testnet USDC from {agent?.name ?? "your agent"}&apos;s wallet.</div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => <button key={s} type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {msgs.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cx("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                  <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-primary text-on-primary" : "bg-secondary-container/40 text-secondary")}>
                    {m.role === "user" ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </span>
                  {m.role === "user"
                    ? <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-on-primary">{m.text}</div>
                    : <AgentBubble ask={m.ask} agentId={agentId} agentPass={auth.data?.agentPass === true} agent={agent} onRetry={(retry) => send(m.query, retry)} />}
                </motion.div>
              ))}
            </AnimatePresence>
            {ask.isPending && (
              <div className="flex items-center gap-3 text-sm text-on-surface-variant">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-container/40 text-secondary"><Bot className="h-4 w-4" /></span>
                <span className="inline-flex gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-secondary" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} />)}</span>
                <span>Choosing a merchant and paying on Hedera…</span>
              </div>
            )}
            {ask.isError && <Alert tone="red">The gateway did not answer. Is it running?</Alert>}
            <div ref={bottom} />
          </div>
          <form className="flex items-center gap-2 border-t border-outline-variant/30 p-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <input className="input" placeholder="Ask your agent for something…" value={text} onChange={(e) => setText(e.target.value)} disabled={ask.isPending} />
            <button className="btn-primary px-3" disabled={ask.isPending || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
          </form>
        </section>

        <aside className="space-y-3">
          {agent && <WalletPanel agentId={agent.id} accountId={agent.hederaAccountId} custodial compact />}
          {agent && (
            <div className="rounded-lg bg-surface-container-low p-3 text-xs text-on-surface-variant">
              <div className="label">Permissions</div>
              <div>Per call up to <b className="text-on-surface">{usd(agent.perCallCap)}</b></div>
              <div>Today <b className="text-on-surface">{usd(agent.spentToday)}</b> of <b className="text-on-surface">{usd(agent.dailyCap)}</b></div>
              <div>Ask me above <b className="text-on-surface">{usd(agent.approvalThreshold)}</b></div>
              <div>Min merchant score <b className="text-on-surface">{agent.minScore}</b> · {agent.allowlistOnly ? `${agent.allowedMerchantIds.length} allowed merchants` : "any live merchant"}</div>
              <Link className="mt-1 inline-block underline" href={`/owner/agents/${agent.id}`}>Change</Link>
            </div>
          )}
          <div className="rounded-lg bg-surface-container-low p-3 text-xs text-on-surface-variant">
            <div className="label">How the agent chooses</div>
            Among merchants it may pay, whose bond covers the call and whose price is within the cap, it takes the highest Arkiv score. A refund happens automatically when a merchant fails any objective check.
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bubbles */
function AgentBubble({ ask, agentId, agentPass, agent, onRetry }: { ask: Ask; agentId: string; agentPass: boolean; agent?: AgentRow; onRetry: (r: Retry) => void }) {
  const m = ask.merchant;
  const body = ask.body ?? {};
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : null;
  const others = ask.candidates.filter((c) => c.eligible && c.slug !== m?.slug);
  const picked = m && (
    <div className="text-xs text-on-surface-variant">
      Chose <b className="text-on-surface">{m.name}</b> (score {m.score ?? "new"}, {usd(m.price)})
      {others.length > 0 && <> over {others.map((o) => `${o.name} (${o.score ?? "new"})`).join(", ")}</>} · {ask.scoreSource === "arkiv" ? "scores read from Arkiv" : "scores from the gateway"}
    </div>
  );
  const tone = ask.outcome === "delivered" ? "ring-secondary/40" : ask.outcome === "refund_pending" ? "ring-amber-300 bg-amber-50/40" : ask.outcome === "error" ? "ring-rose-300 bg-rose-50/40" : "ring-outline-variant/40";

  return (
    <div className={cx("max-w-[85%] space-y-2 rounded-2xl rounded-tl-sm bg-surface-container-lowest px-4 py-3 text-sm ring-1", tone)}>
      {ask.outcome === "delivered" && (
        <>
          <div>Here is what <b>{m?.name}</b> returned:</div>
          <DataView data={body.data} />
          {picked}
          <Footer paid={m?.total} agentTx={ask.agentTx} paymentId={paymentId} />
        </>
      )}
      {ask.outcome === "refund_pending" && (
        <>
          <div><b>{m?.name}</b> failed: {REASON_LABEL[String(body.reason)] ?? String(body.reason)}{body.detail ? ` (${String(body.detail)})` : ""}.</div>
          <div>
            You are being refunded <b>{usd(String(body.refundAmount ?? "0"))}</b>{" "}
            {body.faultCase === "A" ? "from the merchant's bond, and the merchant is slashed on top." : body.faultCase === "B" ? "by the gateway: the merchant failed before it was paid." : "in full: this one was our fault."}
          </div>
          {paymentId && <RefundStatus paymentId={paymentId} />}
          {picked}
          <Footer paid={m?.total} agentTx={ask.agentTx} paymentId={paymentId} />
        </>
      )}
      {ask.outcome === "held" && m && (
        <HeldBubble approvalId={String(body.approvalId)} merchant={m} agent={agent} agentPass={agentPass} agentId={agentId} onRetry={onRetry} />
      )}
      {ask.outcome === "blocked" && (
        <div>Blocked before any payment: <b>{POLICY_ERROR_LABEL[String(body.error)] ?? String(body.error)}</b>. No money moved.{picked}</div>
      )}
      {ask.outcome === "no_merchant" && (
        <>
          <div>No merchant your agent may pay can take this right now. Nothing was paid.</div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-on-surface-variant">
            {ask.candidates.map((c) => <li key={c.id}><b className="text-on-surface">{c.name}</b> ({usd(c.price)}, score {c.score ?? "new"}): {c.why.map((w) => WHY[w] ?? w).join(", ")}</li>)}
          </ul>
          {agent && <Link className="text-xs underline" href={`/owner/agents/${agent.id}`}>Change the agent&apos;s permissions</Link>}
        </>
      )}
      {ask.outcome === "error" && <div>Something went wrong before the call completed: <span className="font-mono text-xs">{ask.error ?? JSON.stringify(ask.body)}</span></div>}
    </div>
  );
}

function HeldBubble({ approvalId, merchant, agent, agentPass, onRetry }: { approvalId: string; merchant: Cand; agent?: AgentRow; agentPass: boolean; agentId: string; onRetry: (r: Retry) => void }) {
  const approve = useMutation({ mutationFn: () => post(`/api/approvals/${approvalId}/approve`), onSuccess: () => onRetry({ approvalId, slug: merchant.slug }) });
  return (
    <>
      <div>This call to <b>{merchant.name}</b> costs <b>{usd(merchant.total)}</b>, above your approval threshold{agent ? ` of ${usd(agent.approvalThreshold)}` : ""}. Nothing has been paid. Approve it?</div>
      <div className="flex flex-wrap gap-2 pt-1">
        {agentPass ? (
          <>
            <a className="btn-primary px-3 py-1.5 text-xs" href={`/api/world/oidc/start?purpose=approval&approvalId=${approvalId}`}><ShieldCheck className="h-4 w-4" /> Approve with World ID</a>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onRetry({ approvalId, slug: merchant.slug })}>I approved it, retry</button>
          </>
        ) : (
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? "Approving…" : "Approve & pay"}</button>
        )}
      </div>
      {approve.isError && <div className="text-xs text-error">Could not approve: it may have expired.</div>}
    </>
  );
}

function RefundStatus({ paymentId }: { paymentId: string }) {
  const r = useQuery({
    queryKey: ["receipt", paymentId], queryFn: () => get<Receipt>(`/api/public/receipts/${paymentId}`),
    refetchInterval: (q) => (q.state.data && ["refunded", "refund_failed"].includes(q.state.data.status) && q.state.data.hcs.sequence ? false : 1500),
  });
  const d = r.data;
  if (!d || d.status === "refund_pending") return <div className="text-xs text-amber-700">Refund in progress on Hedera…</div>;
  if (d.status === "refund_failed") return <div className="text-xs text-error">The refund failed; it is flagged on the dashboard for retry.</div>;
  return (
    <div className="text-xs text-secondary">
      Refunded {usd(d.money.refunded)} ✓ {d.links.refund && <a className="underline" href={d.links.refund} target="_blank" rel="noreferrer">refund tx</a>}
      {Number(d.money.bondSlashed) > 0 && <> · merchant bond slashed {usd(d.money.bondSlashed)}</>}
      {d.hcs.sequence && d.links.hcs && <> · <a className="underline" href={d.links.hcs} target="_blank" rel="noreferrer">HCS #{d.hcs.sequence}</a></>}
    </div>
  );
}

function Footer({ paid, agentTx, paymentId }: { paid?: string; agentTx: string | null; paymentId: string | null }) {
  return (
    <div className="flex flex-wrap gap-x-3 border-t border-outline-variant/30 pt-2 font-mono text-[11px] text-on-surface-variant">
      {paid && <span>paid {usd(paid)}</span>}
      {agentTx && <a className="underline" href={hashscanTx(agentTx, HASHSCAN)} target="_blank" rel="noreferrer">agent tx</a>}
      {paymentId && <Link className="underline" href={`/receipts/${paymentId}`}>receipt</Link>}
    </div>
  );
}

function DataView({ data }: { data: unknown }) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rows = Object.entries(data as Record<string, unknown>);
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface-container-low p-3 font-mono text-xs">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-outline">{k}</dt><dd className="break-all font-semibold">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}
      </dl>
    );
  }
  return <pre className="overflow-x-auto rounded-lg bg-surface-container-low p-3 font-mono text-xs">{typeof data === "string" ? data : JSON.stringify(data, null, 2)}</pre>;
}
