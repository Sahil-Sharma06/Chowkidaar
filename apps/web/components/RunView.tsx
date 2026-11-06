"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { DemoRunResult, Receipt } from "@app/shared";
import { get } from "@/lib/api";
import { Alert, Badge, Money, StatusBadge, TxLink, reasonLabel } from "@/lib/ui";
import { Timeline } from "@/components/Timeline";

const FINAL = new Set(["delivered", "refunded", "refund_failed"]);
const fmt = (m: string) => `${(Number(m) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;

/** The approval id a 202 "held" run came back with, so the next run of the same target can reuse it. */
export const heldApprovalId = (run: DemoRunResult | null) =>
  run?.gatewayStatus === 202 ? (run.gatewayResponse as { approvalId?: string } | null)?.approvalId : undefined;

/** Timeline + outcome panel for one run. Polls the public receipt until the worker has finished it. */
export function RunView({ run, pending, children }: { run: DemoRunResult | null; pending: boolean; children?: React.ReactNode }) {
  const receipt = useQuery({
    queryKey: ["receipt", run?.paymentId],
    queryFn: () => get<Receipt>(`/api/public/receipts/${run!.paymentId}`),
    enabled: Boolean(run?.paymentId),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && FINAL.has(d.status) && (d.hcs.sequence || !d.hcs.topicId) ? false : 1500;
    },
  });
  const held = heldApprovalId(run);

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
    <>
      <section className="card min-h-[320px]">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-on-surface-variant">Timeline</h2>
        {run ? <Timeline steps={steps} /> : pending ? <div className="text-sm text-on-surface-variant">Paying…</div> : <div className="text-sm text-on-surface-variant">Nothing run yet.</div>}
        {run?.error && <Alert tone="red">{run.error}</Alert>}
      </section>

      <aside className="card space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-on-surface-variant">Outcome</h2>
        <Badge tone={tone}>{outcome === "idle" ? "Idle" : outcome === "running" ? "Running" : outcome === "blocked" ? "Blocked before payment" : outcome === "error" ? "Error" : outcome}</Badge>
        {run?.outcome === "blocked" && !held && <Alert tone="blue">No money moved. {String((run.gatewayResponse as { error?: string })?.error ?? "")}</Alert>}
        {held && <Alert tone="amber">Held for a human. No money moved. <Link className="underline" href="/owner/approvals">Approve it with World ID</Link> as the owner, then run again.</Alert>}
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
        {children}
      </aside>
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><dt className="text-on-surface-variant">{k}</dt><dd className="text-right">{children}</dd></div>;
}
