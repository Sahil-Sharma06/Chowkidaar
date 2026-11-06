"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { DemoRunResult, PublicMerchant } from "@app/shared";
import { get, post } from "@/lib/api";
import { Alert, Badge, Money, Stat, cx } from "@/lib/ui";
import { RunView, heldApprovalId } from "@/components/RunView";

/** Scripted tour: our demo agent pays whichever merchant you pick. The list is the live catalog. */
export default function DemoPage() {
  const [slug, setSlug] = useState<string>("");
  const [run, setRun] = useState<DemoRunResult | null>(null);

  const agent = useQuery({ queryKey: ["agent-status"], queryFn: () => get<{ usdcMicro: string; account: string; hashscan: string }>("/demo-agent/status"), refetchInterval: 8000 });
  const merchants = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 5000 });
  const list = merchants.data ?? [];
  useEffect(() => { if (!slug && list[0]) setSlug(list[0].slug); }, [list, slug]);
  const merchant = list.find((m) => m.slug === slug);
  const categories = [...new Set(list.map((m) => m.category))];

  const mutation = useMutation({
    // If the last run against this merchant was held for approval, retry with that approval id.
    mutationFn: (s: string) => post<DemoRunResult>("/demo-agent/run", { scenario: s, approvalId: run?.scenario === s ? heldApprovalId(run) : undefined }),
    onMutate: () => setRun(null),
    onSuccess: (r) => setRun(r),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sandbox</h1>
          <p className="text-sm text-on-surface-variant">Our demo agent pays the merchant you pick, for real, on Hedera testnet. Each merchant says how it behaves.</p>
        </div>
        <Link href="/console" className="btn-secondary">Use your own agent →</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Demo agent wallet" value={agent.data ? <Money micro={agent.data.usdcMicro} /> : "—"} hint={agent.data ? <a className="text-secondary hover:underline" href={agent.data.hashscan} target="_blank" rel="noreferrer">{agent.data.account}</a> : "Demo agent offline"} />
        <Stat label="Merchant bond available" value={merchant ? <Money micro={merchant.bondAvailable} /> : "—"} hint={merchant ? (merchant.covered ? "Covered" : "Not covered") : "—"} />
        <Stat label="Merchant score" value={merchant ? (merchant.score ?? "New") : "—"} hint={merchant ? `${merchant.totalCalls} calls, ${merchant.failedCalls} failed` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr_320px]">
        <aside className="space-y-3">
          {categories.map((cat) => (
            <div key={cat} className="space-y-1.5">
              <div className="label">{cat}</div>
              {list.filter((m) => m.category === cat).map((m) => (
                <button key={m.id} onClick={() => { setSlug(m.slug); setRun(null); }} className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", slug === m.slug ? "border-secondary bg-secondary-container/20" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{m.name}</span><span className="font-mono text-xs"><Money micro={m.price} /></span></div>
                  {m.description && <div className="text-xs text-on-surface-variant">{m.description}</div>}
                  {!m.covered && <Badge tone="amber">not covered</Badge>}
                </button>
              ))}
            </div>
          ))}
          {list.length === 0 && <div className="text-sm text-on-surface-variant">No merchants in the catalog yet.</div>}
          <button className="btn-primary mt-2 w-full" disabled={mutation.isPending || !slug} onClick={() => mutation.mutate(slug)}>
            {mutation.isPending ? "Running…" : merchant ? `Pay ${merchant.name}` : "Run"}
          </button>
          {mutation.isError && <Alert tone="red">Demo agent unreachable. Is it running on port 4200?</Alert>}
        </aside>

        <RunView run={run} pending={mutation.isPending} />
      </div>
    </div>
  );
}
