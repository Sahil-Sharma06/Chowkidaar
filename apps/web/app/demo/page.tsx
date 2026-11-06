"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DEMO_SCENARIOS, type DemoRunResult, type PublicMerchant } from "@app/shared";
import { get, post } from "@/lib/api";
import { Alert, Money, Stat, cx } from "@/lib/ui";
import { RunView, heldApprovalId } from "@/components/RunView";

export default function DemoPage() {
  const [scenario, setScenario] = useState<string>("good-data");
  const [run, setRun] = useState<DemoRunResult | null>(null);

  const agent = useQuery({ queryKey: ["agent-status"], queryFn: () => get<{ usdcMicro: string; account: string; hashscan: string }>("/demo-agent/status"), refetchInterval: 8000 });
  const merchants = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 5000 });
  const slug = scenario === "over-limit" ? "premium-data" : scenario === "needs-approval" ? "big-ticket" : scenario;
  const merchant = merchants.data?.find((m) => m.slug === slug);

  const mutation = useMutation({
    // If the last run of this scenario was held for approval, retry with that approval id.
    mutationFn: (s: string) => post<DemoRunResult>("/demo-agent/run", { scenario: s, approvalId: run?.scenario === s ? heldApprovalId(run) : undefined }),
    onMutate: () => setRun(null),
    onSuccess: (r) => setRun(r),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sandbox</h1>
          <p className="text-sm text-on-surface-variant">Scripted scenarios run by our demo agent. Every button makes a real x402 payment on Hedera testnet.</p>
        </div>
        <Link href="/playground" className="btn-secondary">Pay with your own agent →</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Demo agent wallet" value={agent.data ? <Money micro={agent.data.usdcMicro} /> : "—"} hint={agent.data ? <a className="text-secondary hover:underline" href={agent.data.hashscan} target="_blank" rel="noreferrer">{agent.data.account}</a> : "Demo agent offline"} />
        <Stat label="Merchant bond available" value={merchant ? <Money micro={merchant.bondAvailable} /> : "—"} hint={merchant ? (merchant.covered ? "Covered" : "Not covered") : slug} />
        <Stat label="Merchant score" value={merchant ? (merchant.score ?? "New") : "—"} hint={merchant ? `${merchant.totalCalls} calls, ${merchant.failedCalls} failed` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr_320px]">
        <aside className="space-y-2">
          {DEMO_SCENARIOS.map((s) => (
            <button key={s.id} onClick={() => setScenario(s.id)} className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", scenario === s.id ? "border-secondary bg-secondary-container/20" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low")}>
              <div className="font-medium">{s.label}</div>
              <div className="text-xs text-on-surface-variant">{s.expect}</div>
            </button>
          ))}
          <button className="btn-primary mt-2 w-full" disabled={mutation.isPending} onClick={() => mutation.mutate(scenario)}>
            {mutation.isPending ? "Running…" : "Run scenario"}
          </button>
          {mutation.isError && <Alert tone="red">Demo agent unreachable. Is it running on port 4200?</Alert>}
        </aside>

        <RunView run={run} pending={mutation.isPending}>
          {scenario === "wrong-value" && <Alert tone="amber">Known limit: the format is right but the value is nonsense. Objective checks pass it.</Alert>}
        </RunView>
      </div>
    </div>
  );
}
