"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { PublicMerchant } from "@app/shared";
import { del, get, post, ApiError, HASHSCAN, type SubscriptionRow } from "@/lib/api";
import { Badge, Money, StatusBadge } from "@/lib/ui";

const EVERY = [["120", "2 minutes (demo)"], ["3600", "hour"], ["86400", "day"], ["604800", "week"]] as const;

/**
 * Subscription-style payments: the agent pre-signs one Hedera Scheduled Transaction per run; the network
 * moves the money at each time and the gateway then makes the protected call, refund guarantee included.
 */
export function Subscriptions({ agentId, merchants, allowed }: { agentId: string; merchants: PublicMerchant[]; allowed: Set<string> }) {
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ["subscriptions", agentId], queryFn: () => get<SubscriptionRow[]>(`/api/agents/${agentId}/subscriptions`), refetchInterval: 5000 });
  const choices = merchants.filter((m) => m.status === "live" && (allowed.size === 0 || allowed.has(m.id)));
  const [f, setF] = useState({ slug: "", everySec: "120", times: "3", query: "" });
  const slug = f.slug || choices[0]?.slug || "";
  const invalidate = () => qc.invalidateQueries({ queryKey: ["subscriptions", agentId] });
  const subscribe = useMutation({
    mutationFn: () => post<SubscriptionRow>(`/api/agents/${agentId}/subscribe`, { slug, everySec: Number(f.everySec), times: Number(f.times), body: f.query ? { query: f.query } : {} }),
    onSuccess: invalidate,
  });
  const cancel = useMutation({ mutationFn: (id: string) => del(`/api/agents/${agentId}/subscriptions/${id}`), onSuccess: invalidate });
  const now = Date.now();

  return (
    <section className="card space-y-3">
      <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-secondary" /><h2 className="font-semibold">Subscriptions</h2>
        <span className="text-xs text-on-surface-variant">Recurring protected calls, each pre-paid by a Hedera Scheduled Transaction signed by the agent now.</span></div>
      <form className="flex flex-wrap items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); subscribe.mutate(); }}>
        <select className="input w-auto" value={slug} onChange={(e) => setF({ ...f, slug: e.target.value })} aria-label="Merchant">
          {choices.map((m) => <option key={m.id} value={m.slug}>{m.name} · {(Number(m.price) / 1e6).toFixed(2)} USDC</option>)}
        </select>
        every
        <select className="input w-auto" value={f.everySec} onChange={(e) => setF({ ...f, everySec: e.target.value })} aria-label="Interval">{EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        × <input className="input w-14" type="number" min={1} max={8} value={f.times} onChange={(e) => setF({ ...f, times: e.target.value })} aria-label="Times" />
        <input className="input w-48" placeholder="request (optional)" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} aria-label="Request body" />
        <button type="submit" className="btn-secondary" disabled={subscribe.isPending || !slug}>{subscribe.isPending ? "Signing schedules…" : "Subscribe"}</button>
        {subscribe.isError && <span className="text-error text-xs">{subscribe.error instanceof ApiError ? `Blocked: ${subscribe.error.code}` : "Could not create the subscription."}</span>}
      </form>
      {subs.data?.map((s) => (
        <div key={s.id} className="rounded-lg bg-surface-container-low p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{s.merchantName}</span>
            <Money micro={s.amount} /> <span className="text-xs text-on-surface-variant">per run · every {EVERY.find(([v]) => v === String(s.everySec))?.[1] ?? `${s.everySec}s`} · {s.runs.length} runs</span>
            {s.status === "cancelled" ? <Badge tone="amber">Cancelled</Badge> : <Badge tone="green">Active</Badge>}
            {s.status === "active" && s.runs.some((r) => r.status === "scheduled") && (
              <button className="btn-ghost ml-auto px-2 py-1 text-xs" disabled={cancel.isPending} onClick={() => { if (confirm("Cancel the remaining runs? Scheduled transactions still waiting are deleted on-chain.")) cancel.mutate(s.id); }}>Cancel remaining</button>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {s.runs.map((r) => (
              <li key={r.scheduleId} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-on-surface-variant">#{r.n}</span>
                <span>{r.status === "scheduled" ? (r.executeAt > now ? "Fires" : "Firing") : "Fired"} {new Date(r.executeAt).toLocaleString()}</span>
                <a className="font-mono text-secondary hover:underline" href={`${HASHSCAN}/schedule/${r.scheduleId}`} target="_blank" rel="noreferrer">{r.scheduleId}</a>
                {r.status === "done" && r.paymentId && <><StatusBadge status={r.paymentStatus ?? "calling"} /><Link className="text-blue-700 hover:underline" href={`/receipts/${r.paymentId}`}>Receipt</Link></>}
                {r.status === "failed" && <Badge tone="red">Not executed</Badge>}
                {r.status === "cancelled" && <Badge tone="amber">Cancelled</Badge>}
                {r.error && <span className="text-error">{r.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {subs.data?.length === 0 && <div className="text-xs text-on-surface-variant">No subscriptions yet.</div>}
    </section>
  );
}
