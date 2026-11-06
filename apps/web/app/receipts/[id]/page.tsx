"use client";
import Link from "next/link";
import { AgentId } from "@/components/AgentId";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { DemoStep, Receipt } from "@app/shared";
import { ApiError, get } from "@/lib/api";
import { Alert, CopyButton, StatusBadge, TxLink, cx, fmtTime, reasonLabel } from "@/lib/ui";
import { LoadError, usdc } from "@/components/owner/kit";
import { Timeline } from "@/components/Timeline";

const FINAL = new Set(["delivered", "refunded", "refund_failed"]);

const TITLE: Record<string, string> = {
  delivered: "Delivered",
  refunded: "Refunded",
  refund_pending: "Refund in progress",
  refund_failed: "Refund failed",
  calling: "In progress",
};

const FAULT: Record<string, string> = {
  A: "The merchant failed after being paid, so the refund came from its bond.",
  B: "The merchant failed before settling, so the gateway refunded the agent and no bond was slashed.",
  C: "The gateway made an error, so the agent got everything back, fee included.",
};

/** The receipt's story as steps, built from what the gateway recorded. */
function stepsFor(r: Receipt): DemoStep[] {
  const failed = r.status !== "delivered" && r.status !== "calling";
  const steps: DemoStep[] = [
    r.tx.agent || r.status !== "calling"
      ? { key: "agent_pay", label: "Agent paid the gateway", state: "done", detail: `${usdc(r.money.agentPaid)} USDC, price ${usdc(r.money.price)} plus ${usdc(r.money.fee)} protection fee`, link: r.links.agent ?? undefined }
      : { key: "agent_pay", label: "Agent paying the gateway", state: "running" },
    r.faultCase === "B"
      ? { key: "merchant_pay", label: "Merchant was never paid", state: "skipped", detail: "It failed before the payment settled." }
      : r.faultCase === "C"
        ? { key: "merchant_pay", label: "Gateway error", state: "failed", detail: "The call didn't complete because of our error." }
        : r.tx.merchant || r.status !== "calling"
          ? { key: "merchant_pay", label: "Gateway paid the merchant and called it", state: "done", detail: `${usdc(r.money.merchantReceived)} USDC to ${r.merchant.name}`, link: r.links.merchant ?? undefined }
          : { key: "merchant_pay", label: "Calling the merchant", state: r.tx.agent ? "running" : "pending" },
    r.status === "delivered"
      ? { key: "checks", label: "Response checked", state: "done", detail: [r.httpStatus != null ? `HTTP ${r.httpStatus}` : null, r.latencyMs != null ? `${r.latencyMs} ms` : null, "status, body, format and schema passed"].filter(Boolean).join(", ") }
      : failed
        ? { key: "checks", label: "Response failed the checks", state: "failed", detail: [reasonLabel(r.reason), r.detail].filter(Boolean).join(". ") || undefined }
        : { key: "checks", label: "Checking the response", state: "pending" },
  ];
  if (failed) {
    steps.push(
      r.status === "refunded"
        ? { key: "refund", label: "Agent refunded", state: "done", detail: `${usdc(r.money.refunded)} USDC back${Number(r.money.bondSlashed) > 0 ? `, ${usdc(r.money.bondSlashed)} USDC taken from the merchant's bond` : ""}`, link: r.links.refund ?? undefined }
        : r.status === "refund_failed"
          ? { key: "refund", label: "Refund failed", state: "failed", detail: "The refund didn't go through. It shows on the owner's dashboard." }
          : { key: "refund", label: "Refunding the agent", state: "running", detail: `${usdc(r.money.refunded)} USDC on its way back` },
    );
  }
  steps.push(
    r.hcs.sequence
      ? { key: "hcs", label: "Receipt written to Hedera Consensus Service", state: "done", detail: `Sequence #${r.hcs.sequence}`, link: r.links.hcs ?? undefined }
      : r.hcs.topicId
        ? { key: "hcs", label: "Writing the receipt to Hedera Consensus Service", state: "running", detail: "Waiting for the worker" }
        : { key: "hcs", label: "No public record", state: "skipped", detail: "HCS isn't configured on this gateway." },
  );
  return steps;
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => get<Receipt>(`/api/public/receipts/${id}`),
    // A missing receipt won't appear by asking again; anything else gets the usual retries.
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
    refetchInterval: (query) => { const d = query.state.data; return d && FINAL.has(d.status) && (d.hcs.sequence || !d.hcs.topicId) ? false : 1500; },
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5" aria-busy>
        <div className="skeleton h-56 rounded-[24px]" />
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-12"><div className="skeleton h-80 rounded-[24px] lg:col-span-7" /><div className="skeleton h-80 rounded-[24px] lg:col-span-5" /></div>
      </div>
    );
  }
  if (!q.data) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <div className="mx-auto max-w-xl space-y-4">
          <Alert tone="red">There&apos;s no receipt with this id. Check the link, or find the call in the receipt list.</Alert>
          <Link href="/receipts" className="btn-secondary">See all receipts</Link>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <LoadError what="this receipt" retry={() => q.refetch()} />
        <Link href="/receipts" className="btn-ghost -ml-4">All receipts</Link>
      </div>
    );
  }

  const r = q.data;
  const back = Number(r.money.refunded) > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">
      <Link href="/receipts" className="btn-ghost -ml-4">All receipts</Link>

      {/* Hero: what this payment was and how it ended. */}
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusBadge status={r.status} />
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-on-surface-variant">
            <span>Receipt</span>
            <span className="min-w-0 break-all font-mono text-on-surface">{r.paymentId}</span>
            <CopyButton text={r.paymentId} label="Copy receipt id" />
          </div>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
          <div>
            <h1 className="font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">{TITLE[r.status] ?? r.status}</h1>
            {r.reason && <p className="mt-1 text-[15px] text-on-surface-variant">{reasonLabel(r.reason)}</p>}
            {r.detail && <p className="mt-1 max-w-[65ch] break-words text-sm text-outline">{r.detail}</p>}
            <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className={cx("money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]", back && "text-on-surface-variant")}>
                  {usdc(r.money.agentPaid)}<span className="ml-2 text-base font-normal text-on-surface-variant">USDC</span>
                </div>
                <div className="mt-2 text-sm text-on-surface-variant">Agent paid</div>
              </div>
              {back && (
                <div>
                  <div className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em] text-gain">
                    +{usdc(r.money.refunded)}<span className="ml-2 text-base font-normal text-on-surface-variant">USDC</span>
                  </div>
                  <div className="mt-2 text-sm text-on-surface-variant">Refunded to the agent</div>
                </div>
              )}
            </div>
          </div>

          <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Meta k="Merchant">
              <div className="truncate font-medium">{r.merchant.name}</div>
              <div className="truncate text-xs text-on-surface-variant">{r.merchant.slug}</div>
            </Meta>
            <Meta k="Agent">
              <div className="truncate font-medium">{r.agentName}</div>
              <div className="break-all font-mono text-xs text-on-surface-variant">{r.agentAccount}</div>
            </Meta>
            <Meta k="Time">
              <div className="font-medium">{fmtTime(r.createdAt)}</div>
              <div className="text-xs text-on-surface-variant">{r.finishedAt ? `Finished ${fmtTime(r.finishedAt)}` : "Not finished yet"}</div>
            </Meta>
          </dl>
        </div>
      </section>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <section className="panel lg:col-span-7">
          <PanelTitle>What happened</PanelTitle>
          <div className="mt-6"><Timeline steps={stepsFor(r)} /></div>
        </section>

        <section className="panel lg:col-span-5">
          <PanelTitle sub="All amounts in USDC">Money</PanelTitle>
          <dl className="mt-4">
            <Row k="Price">{usdc(r.money.price)}</Row>
            <Row k="Protection fee">{usdc(r.money.fee)}</Row>
            <Row k="Agent paid" strong>{usdc(r.money.agentPaid)}</Row>
            <Row k="Merchant received">{usdc(r.money.merchantReceived)}</Row>
            <Row k="Refunded to agent" tone={back ? "ok" : undefined}>{back ? `+${usdc(r.money.refunded)}` : usdc(r.money.refunded)}</Row>
            <Row k="Protection fee kept">{usdc(r.money.feeKept)}</Row>
            <Row k="Bond slashed" tone={Number(r.money.bondSlashed) > 0 ? "bad" : undefined}>{usdc(r.money.bondSlashed)}</Row>
          </dl>
          {r.faultCase && <p className="mt-4 rounded-2xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">{FAULT[r.faultCase] ?? `Fault case ${r.faultCase}.`}</p>}
        </section>

        <section className="panel lg:col-span-7">
          <PanelTitle sub="Anyone can check these on public explorers">Proof on Hedera</PanelTitle>
          <dl className="mt-4">
            <Row k="Agent payment"><TxLink id={r.tx.agent} /></Row>
            <Row k="Merchant payment"><TxLink id={r.tx.merchant} /></Row>
            <Row k="Refund"><TxLink id={r.tx.refund} /></Row>
            <Row k="Public record (HCS)">
              {r.hcs.sequence ? <TxLink href={r.links.hcs} label={`Topic ${r.hcs.topicId} #${r.hcs.sequence}`} />
                : r.hcs.topicId ? <span className="pill pill-info">Pending</span>
                  : <span className="text-outline">Off</span>}
            </Row>
            <Row k="Arkiv reputation"><TxLink href={r.links.arkiv} label="Merchant record" /></Row>
            {r.agentUaid && <Row k="Agent ID (HCS-14)"><AgentId uaid={r.agentUaid} className="justify-end" /></Row>}
          </dl>
        </section>

        <section className="panel lg:col-span-5">
          <PanelTitle>Evidence</PanelTitle>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tile k="HTTP status" v={r.httpStatus != null ? String(r.httpStatus) : "–"} />
            <Tile k="Latency" v={r.latencyMs != null ? `${r.latencyMs}\u00a0ms` : "–"} />
            <Tile k="Finished" v={r.finishedAt ? new Date(r.finishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "–"} title={fmtTime(r.finishedAt)} />
          </div>
          <div className="mt-4">
            <div className="text-xs text-on-surface-variant">Response fingerprint (SHA-256)</div>
            <div className="mt-1.5 flex items-start gap-1 rounded-2xl bg-surface-container-low px-3.5 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">{r.responseHash ?? "–"}</code>
              {r.responseHash && <CopyButton text={r.responseHash} label="Copy response fingerprint" />}
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-outline">The response itself isn&apos;t stored on-chain, only this fingerprint. The gateway records this receipt.</p>
        </section>
      </div>
    </div>
  );
}

function PanelTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">{children}</h2>
      {sub && <p className="mt-0.5 text-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-container-low px-4 py-3">
      <dt className="text-xs text-on-surface-variant">{k}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function Row({ k, children, strong, tone }: { k: string; children: React.ReactNode; strong?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-rule py-3 text-sm first:border-t-0">
      <dt className="text-on-surface-variant">{k}</dt>
      <dd className={cx("money min-w-0 truncate text-right", strong && "font-semibold", tone === "ok" && "font-medium text-gain", tone === "bad" && "text-bad")}>{children}</dd>
    </div>
  );
}

function Tile({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="rounded-2xl bg-surface-container-low px-3.5 py-3" title={title}>
      <div className="money font-display text-2xl font-semibold leading-tight">{v}</div>
      <div className="mt-1 text-xs text-on-surface-variant">{k}</div>
    </div>
  );
}
