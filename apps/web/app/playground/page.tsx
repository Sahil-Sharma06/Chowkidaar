"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, FlaskConical, Loader2 } from "lucide-react";
import { formatUsdc, type DemoRunResult, type PublicMerchant } from "@app/shared";
import { ApiError, get, post, type AgentRow, type Config } from "@/lib/api";
import { Alert, cx } from "@/lib/ui";
import { LoadError, PageHeader, usdc } from "@/components/owner/kit";
import { ErrorCard, RunView, heldApprovalId } from "@/components/RunView";
import { WalletPanel } from "@/components/WalletPanel";

export default function PlaygroundPage() {
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents"), retry: false });
  const merchants = useQuery({ queryKey: ["owner-merchants"], queryFn: () => get<PublicMerchant[]>("/api/owner/merchants"), refetchInterval: 8000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });

  const custodial = agents.data?.filter((a) => a.custodial) ?? [];
  const [agentId, setAgentId] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [body, setBody] = useState('{\n  "query": "hbar-price"\n}');
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [run, setRun] = useState<DemoRunResult | null>(null);
  useEffect(() => { if (!agentId && custodial[0]) setAgentId(custodial[0].id); }, [custodial, agentId]);
  useEffect(() => { if (!slug && merchants.data?.[0]) setSlug(merchants.data[0].slug); }, [merchants.data, slug]);

  const agent = custodial.find((a) => a.id === agentId);
  const merchant = merchants.data?.find((m) => m.slug === slug);
  const allowed = !agent || !agent.allowlistOnly || agent.allowedMerchantIds.includes(merchant?.id ?? "");
  const feeBps = cfg.data?.feeBps ?? 200;
  const total = merchant ? Number(merchant.price) + Math.floor((Number(merchant.price) * feeBps) / 10_000) : 0;

  const mutation = useMutation({
    mutationFn: (parsed: Record<string, unknown>) => post<DemoRunResult>(`/api/agents/${agentId}/play`, {
      slug, body: parsed, approvalId: run?.scenario === slug ? heldApprovalId(run) : undefined,
    }),
    onMutate: () => setRun(null),
    onSuccess: (r) => setRun(r),
  });

  const go = () => {
    setBodyError(null);
    let parsed: Record<string, unknown>;
    try { parsed = body.trim() ? (JSON.parse(body) as Record<string, unknown>) : {}; } catch { setBodyError("The request body isn't valid JSON. Check for a missing quote or trailing comma."); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setBodyError("The request body must be a JSON object, like { \"query\": \"hbar-price\" }."); return; }
    if (mutation.isPending) return;
    mutation.mutate(parsed);
  };

  if (agents.error instanceof ApiError && agents.error.status === 401) {
    return (
      <Gate title="Sign in to use the playground" body="The playground pays from your agent's wallet, so it needs to know whose agents to show.">
        <Link className="btn-primary" href="/login">Sign in</Link>
      </Gate>
    );
  }
  if (agents.isError && !agents.data) {
    return (
      <div>
        <PageHeader title="Playground" />
        <LoadError what="your agents" retry={() => agents.refetch()} />
      </div>
    );
  }
  if (agents.data && custodial.length === 0) {
    return (
      <Gate title="Create an agent to pay from" body="The playground pays from a wallet we hold for your agent. Create an agent, choose “Create one for me” as its wallet, and come back here.">
        <Link href="/owner/agents/new" className="btn-primary">Create an agent</Link>
      </Gate>
    );
  }

  return (
    <div>
      <PageHeader title="Playground" sub="Pick a merchant and send it a request. Your agent pays with real testnet USDC and you watch each step." />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[340px_1fr_320px]">
        <aside className="panel space-y-6">
          <div className="space-y-4">
            {custodial.length > 0 ? <AgentPicker agents={custodial} value={agentId} onChange={(id) => { setAgentId(id); setRun(null); }} /> : <div className="skeleton h-11 rounded-full" />}
            {agent ? <WalletPanel agentId={agent.id} accountId={agent.hederaAccountId} custodial compact /> : <div className="skeleton h-28" />}
            {agent && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                <span className="money">Up to {usdc(agent.perCallCap)} per payment, {usdc(agent.dailyCap)} a day, asks above {usdc(agent.approvalThreshold)}&nbsp;USDC.</span>
                <Link className="inline-flex min-h-6 items-center text-on-surface underline decoration-outline underline-offset-4 hover:text-primary hover:decoration-primary" href={`/owner/agents/${agent.id}`}>Edit limits</Link>
              </div>
            )}
          </div>

          <div>
            <div className="label">Merchant</div>
            {merchants.isError && !merchants.data ? <LoadError what="merchants" retry={() => merchants.refetch()} />
              : !merchants.data ? <div className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>
              : merchants.data.length === 0 ? <p className="text-sm text-on-surface-variant">No merchants are live yet. Once one posts a bond it shows up here.</p> : (
              <div role="group" aria-label="Merchant" className="-mr-1 max-h-80 space-y-2 overflow-y-auto pr-1">
                {merchants.data.map((m) => {
                  const ok = !agent?.allowlistOnly || agent.allowedMerchantIds.includes(m.id);
                  const on = slug === m.slug;
                  return (
                    <button key={m.id} type="button" onClick={() => { setSlug(m.slug); setRun(null); }} aria-pressed={on}
                      className={cx("w-full rounded-2xl px-4 py-3 text-left transition-colors",
                        on ? "bg-surface-container-high" : "bg-surface-container-low hover:bg-surface-container")}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", on ? "bg-primary text-on-primary" : "bg-surface-container-high")} aria-hidden>{on && <Check className="h-3 w-3" />}</span>
                          <span className="truncate text-sm font-medium">{m.name}</span>
                        </span>
                        <span className="money shrink-0 text-sm">{usdc(m.price)}&nbsp;<span className="text-xs text-on-surface-variant">USDC</span></span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7 text-xs text-on-surface-variant">
                        <span className="font-mono">{m.slug}</span>
                        <span>{m.score == null ? "New" : `Score ${m.score}`}</span>
                        {!m.covered && <span className="pill pill-warn">Bond too low</span>}
                        {!ok && <span className="pill pill-muted">Not allowed</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <details className="group" open>
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden">
              Request body <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <label className="mt-2 block">
              <span className="sr-only">Request body as JSON</span>
              <textarea className="input font-mono sm:text-[13px]" rows={4} spellCheck={false} value={body} aria-invalid={bodyError ? true : undefined} aria-describedby={bodyError ? "body-error" : undefined}
                onChange={(e) => { setBody(e.target.value); if (bodyError) setBodyError(null); }} />
            </label>
          </details>

          {bodyError && <p id="body-error" role="alert" className="text-sm text-bad">{bodyError}</p>}
          {!allowed && agent && <Alert tone="amber">This merchant isn&apos;t on the agent&apos;s allowed list, so the payment will be blocked. <Link className="font-medium underline underline-offset-4" href={`/owner/agents/${agent.id}`}>Allow it</Link> or turn the list off.</Alert>}

          <div className="space-y-2">
            <button className="btn-primary w-full" disabled={mutation.isPending || !agent || !merchant} onClick={go} aria-busy={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
              {mutation.isPending ? "Paying…" : merchant ? `Pay ${formatUsdc(total)} and call` : "Pay and call"}
            </button>
            {merchant && <div className="money text-center text-xs text-outline">{formatUsdc(merchant.price)} price plus {feeBps / 100}% protection fee</div>}
          </div>
          {mutation.isError && <ErrorCard error={mutation.error} onRetry={go} offline="Couldn't reach the gateway, so nothing was paid. Try again." />}
        </aside>

        <RunView run={run} pending={mutation.isPending} />
      </div>
    </div>
  );
}

function Gate({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-on-surface-variant" aria-hidden><FlaskConical className="h-5 w-5" /></span>
      <h1 className="mt-6 font-display text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-3 text-sm text-on-surface-variant">{body}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function AgentPicker({ agents, value, onChange }: { agents: AgentRow[]; value: string; onChange: (id: string) => void }) {
  const current = agents.find((a) => a.id === value);
  return (
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">Agent</span>
      <span className={cx("pointer-events-none absolute left-1.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold", current?.status === "paused" ? "bg-surface-container-highest text-on-surface-variant" : "bg-surface-container-highest text-on-surface")} aria-hidden>
        {(current?.name ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-surface-container pl-12 pr-10 text-base font-medium text-on-surface transition-colors hover:bg-surface-container-high sm:text-sm">
        {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 h-4 w-4 text-on-surface-variant" aria-hidden />
    </label>
  );
}
