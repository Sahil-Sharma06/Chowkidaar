"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DEMO_SCENARIOS, type DemoRunResult, type PublicMerchant, type Receipt } from "@app/shared";
import { get, post } from "@/lib/api";
import { Alert, Badge, Money, Stat, StatusBadge, TxLink, cx, reasonLabel } from "@/lib/ui";
import { Timeline } from "@/components/Timeline";

const FINAL = new Set(["delivered", "refunded", "refund_failed"]);

export default function DemoPage() {
  const [scenario, setScenario] = useState<string>("good-data");
  const [run, setRun] = useState<DemoRunResult | null>(null);

  const agent = useQuery({ queryKey: ["agent-status"], queryFn: () => get<{ usdcMicro: string; account: string; hashscan: string }>("/demo-agent/status"), refetchInterval: 8000 });
  const merchants = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 5000 });
  const slug = scenario === "over-limit" ? "premium-data" : scenario;
  const merchant = merchants.data?.find((m) => m.slug === slug);

  const receipt = useQuery({
    queryKey: ["receipt", run?.paymentId],
    queryFn: () => get<Receipt>(`/api/public/receipts/${run!.paymentId}`),
    enabled: Boolean(run?.paymentId),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && FINAL.has(d.status) && (d.hcs.sequence || !d.hcs.topicId) ? false : 1500;
    },
  });

  const mutation = useMutation({
    // If the last run of this scenario was held for approval, retry with that approval id.
    mutationFn: (s: string) => post<DemoRunResult>("/demo-agent/run", {
      scenario: s,
      approvalId: run?.scenario === s ? (run.gatewayResponse as { approvalId?: string } | null)?.approvalId : undefined,
    }),
    onMutate: () => setRun(null),
    onSuccess: (r) => setRun(r),
  });
  const heldApproval = run?.gatewayStatus === 202 ? (run.gatewayResponse as { approvalId?: string } | null)?.approvalId : undefined;

  // Merge live receipt state into the step list.
  const steps = run ? run.steps.map((s) => {
    const r = receipt.data;
    if (!r) return s;
    if (s.key === "outcome" && FINAL.has(r.status)) {
      return { ...s, state: "done" as const, detail: r.status === "delivered" ? "Delivered" : r.status === "refunded" ? `Refunded ${fmt(r.money.refunded)}${Number(r.money.bondSlashed) > 0 ? `, bond slashed ${fmt(r.money.bondSlashed)}` : ""}` : "Refund failed, shown on dashboard", link: r.links.refund ?? undefined };
    }
    if (s.key === "merchant_pay" && r.links.merchant) return { ...s, link: r.links.merchant };
    if (s.key === "agent_pay" && r.links.agent) return { ...s, link: r.links.agent };
    if (s.key === "hcs") return r.hcs.sequence ? { ...s, state: "done" as const, detail: `Sequence #${r.hcs.sequence}`, link: r.links.hcs ?? undefined } : !r.hcs.topicId ? { ...s, state: "skipped" as const, detail: "HCS topic not configured" } : { ...s, state: "running" as const, detail: "Waiting for the worker" };
    return s;
  }) : [];

  const outcome = receipt.data?.status ?? (run?.outcome === "blocked" ? "blocked" : run?.outcome === "error" ? "error" : run ? "running" : "idle");
  const tone = outcome === "delivered" ? "green" : outcome === "refunded" || outcome === "refund_pending" ? "amber" : outcome === "blocked" ? "grey" : outcome === "error" || outcome === "refund_failed" ? "red" : "blue";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Live demo</h1>
        <p className="text-sm text-slate-600">Every button makes a real x402 payment on Hedera testnet. Nothing here is mocked.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Agent wallet" value={agent.data ? <Money micro={agent.data.usdcMicro} /> : "—"} hint={agent.data ? <a className="text-blue-700 hover:underline" href={agent.data.hashscan} target="_blank" rel="noreferrer">{agent.data.account}</a> : "Demo agent offline"} />
        <Stat label="Merchant bond available" value={merchant ? <Money micro={merchant.bondAvailable} /> : "—"} hint={merchant ? (merchant.covered ? "Covered" : "Not covered") : slug} />
        <Stat label="Merchant score" value={merchant ? (merchant.score ?? "New") : "—"} hint={merchant ? `${merchant.totalCalls} calls, ${merchant.failedCalls} failed` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr_320px]">
        <aside className="space-y-2">
          {DEMO_SCENARIOS.map((s) => (
            <button key={s.id} onClick={() => setScenario(s.id)} className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", scenario === s.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
              <div className="font-medium">{s.label}</div>
              <div className="text-xs text-slate-500">{s.expect}</div>
            </button>
          ))}
          <button className="btn-primary mt-2 w-full" disabled={mutation.isPending} onClick={() => mutation.mutate(scenario)}>
            {mutation.isPending ? "Running…" : "Run scenario"}
          </button>
          {mutation.isError && <Alert tone="red">Demo agent unreachable. Is it running on port 4200?</Alert>}
        </aside>

        <section className="card min-h-[320px]">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
          {run ? <Timeline steps={steps} /> : mutation.isPending ? <div className="text-sm text-slate-500">Paying…</div> : <div className="text-sm text-slate-500">Pick a scenario and run it.</div>}
          {run?.error && <Alert tone="red">{run.error}</Alert>}
        </section>

        <aside className="card space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Outcome</h2>
          <Badge tone={tone}>{outcome === "idle" ? "Idle" : outcome === "running" ? "Running" : outcome === "blocked" ? "Blocked before payment" : outcome === "error" ? "Error" : outcome}</Badge>
          {run?.outcome === "blocked" && !heldApproval && <Alert tone="blue">No money moved. {String((run.gatewayResponse as { error?: string })?.error ?? "")}</Alert>}
          {heldApproval && <Alert tone="amber">Held for a human. No money moved. <Link className="underline" href="/owner/approvals">Approve it with World ID</Link> as the owner, then run this scenario again.</Alert>}
          {receipt.data && (
            <dl className="space-y-1.5 text-sm">
              <Row k="Status"><StatusBadge status={receipt.data.status} /></Row>
              {receipt.data.reason && <Row k="Reason">{reasonLabel(receipt.data.reason)}</Row>}
              <Row k="Agent paid"><Money micro={receipt.data.money.agentPaid} /></Row>
              <Row k="Merchant received"><Money micro={receipt.data.money.merchantReceived} /></Row>
              <Row k="Refunded"><Money micro={receipt.data.money.refunded} /></Row>
              <Row k="Bond slashed"><Money micro={receipt.data.money.bondSlashed} /></Row>
              <Row k="Agent tx"><TxLink id={receipt.data.tx.agent} label="HashScan" /></Row>
              <Row k="Merchant tx"><TxLink id={receipt.data.tx.merchant} label="HashScan" /></Row>
              <Row k="Refund tx"><TxLink id={receipt.data.tx.refund} label="HashScan" /></Row>
              <Row k="HCS"><TxLink href={receipt.data.links.hcs} label={receipt.data.hcs.sequence ? `#${receipt.data.hcs.sequence}` : undefined} /></Row>
            </dl>
          )}
          {run?.paymentId && <Link className="btn-secondary w-full" href={`/receipts/${run.paymentId}`}>Open public receipt</Link>}
          {scenario === "wrong-value" && <Alert tone="amber">Known limit: the format is right but the value is nonsense. Objective checks pass it.</Alert>}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-right">{children}</dd></div>;
}
const fmt = (m: string) => `${(Number(m) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;
