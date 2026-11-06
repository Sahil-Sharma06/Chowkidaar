"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatUsdc, type DemoRunResult, type PublicMerchant } from "@app/shared";
import { get, post, type AgentRow, type Config } from "@/lib/api";
import { Alert, Badge, Field, Money, cx } from "@/lib/ui";
import { RunView, heldApprovalId } from "@/components/RunView";
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
    try { parsed = body.trim() ? (JSON.parse(body) as Record<string, unknown>) : {}; } catch { setBodyError("The request body must be valid JSON."); return; }
    mutation.mutate(parsed);
  };

  if (agents.isError) return <Alert tone="amber">Sign in as an agent owner to use the playground. <Link className="underline" href="/login">Sign in</Link></Alert>;
  if (agents.data && custodial.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="font-display text-2xl font-semibold">Playground</h1>
        <Alert tone="blue">You need an agent with a gateway-created wallet to pay from here. Create one and leave the Hedera account empty.</Alert>
        <Link href="/owner/agents/new" className="btn-primary">Create an agent</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Playground</h1>
        <p className="text-sm text-on-surface-variant">Your agent pays a real merchant with real testnet USDC. Pick a service, send a request, watch the money move.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr_320px]">
        <aside className="space-y-4">
          <Field label="Agent">
            <select className="input" value={agentId} onChange={(e) => { setAgentId(e.target.value); setRun(null); }}>
              {custodial.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.hederaAccountId}</option>)}
            </select>
          </Field>
          {agent && <WalletPanel agentId={agent.id} accountId={agent.hederaAccountId} custodial compact />}
          {agent && <div className="text-xs text-on-surface-variant">Caps: <Money micro={agent.perCallCap} /> per call · <Money micro={agent.dailyCap} /> daily · approval above <Money micro={agent.approvalThreshold} /> · <Link className="underline" href={`/owner/agents/${agent.id}`}>edit</Link></div>}

          <div>
            <div className="label">Merchant</div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {merchants.data?.map((m) => {
                const ok = !agent?.allowlistOnly || agent.allowedMerchantIds.includes(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => { setSlug(m.slug); setRun(null); }}
                    className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", slug === m.slug ? "border-secondary bg-secondary-container/20" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low")}>
                    <div className="flex items-center justify-between gap-2"><span className="font-medium">{m.name}</span><span className="font-mono text-xs">{formatUsdc(m.price)}</span></div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-on-surface-variant">
                      <span>{m.slug}</span>
                      <span>· score {m.score ?? "new"}</span>
                      {!m.covered && <Badge tone="amber">not covered</Badge>}
                      {!ok && <Badge tone="grey">not allowed</Badge>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Field label="Request body (JSON)"><textarea className="input font-mono text-xs" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {bodyError && <Alert tone="red">{bodyError}</Alert>}
          {!allowed && agent && <Alert tone="amber">This merchant is not on the agent&apos;s allowlist. <Link className="underline" href={`/owner/agents/${agent.id}`}>Allow it</Link> or turn the allowlist off.</Alert>}

          <button className="btn-primary w-full" disabled={mutation.isPending || !agent || !merchant} onClick={go}>
            {mutation.isPending ? "Paying…" : merchant ? `Pay ${formatUsdc(total)} & call` : "Pay & call"}
          </button>
          {merchant && <div className="text-center text-xs text-on-surface-variant">{formatUsdc(merchant.price)} price + {feeBps / 100}% protection fee</div>}
          {mutation.isError && <Alert tone="red">The gateway did not answer. Is it running?</Alert>}
        </aside>

        <RunView run={run} pending={mutation.isPending} />
      </div>
    </div>
  );
}
