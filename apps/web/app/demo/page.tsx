"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Play } from "lucide-react";
import type { DemoRunResult, PublicMerchant } from "@app/shared";
import { get, post } from "@/lib/api";
import { cx } from "@/lib/ui";
import { LoadError, PageHeader, usdc } from "@/components/owner/kit";
import { Gauge } from "@/components/owner/charts";
import { ErrorCard, RunView, TechDetails, heldApprovalId } from "@/components/RunView";

const OFFLINE = "The demo agent is offline right now. Try again in a minute.";

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
  const pay = () => { if (slug && !mutation.isPending) mutation.mutate(slug); };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="Sandbox"
        sub={<span className="block max-w-[68ch]">Our demo agent pays the merchant you pick, for real, on Hedera testnet. Each merchant says how it behaves.</span>}
        actions={<Link href="/console" className="btn-secondary">Use your own agent</Link>}
      />

      <section className="panel grid gap-x-6 gap-y-5 sm:grid-cols-3 sm:divide-x sm:divide-rule">
        <Figure loading={agent.isLoading} value={agent.data ? usdc(agent.data.usdcMicro) : agent.isError ? "Offline" : undefined} unit={agent.data ? "USDC" : undefined} label="Demo agent wallet"
          hint={agent.data
            ? <a className="inline-flex items-center gap-1 font-mono transition-colors hover:text-primary" href={agent.data.hashscan} target="_blank" rel="noreferrer">{agent.data.account} <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens HashScan)</span></a>
            : agent.isError ? "Payments below will fail until it's back" : undefined} />
        <Figure loading={merchants.isLoading} value={merchant ? usdc(merchant.bondAvailable) : undefined} unit={merchant ? "USDC" : undefined} label="Merchant bond available"
          hint={merchant ? (merchant.covered ? "Covers this call" : <span className="text-warn">Doesn&apos;t cover this call</span>) : "Pick a merchant"} />
        <div className="flex items-center justify-between gap-4 sm:pl-6">
          <Figure flush loading={merchants.isLoading} value={merchant ? (merchant.score == null ? "New" : String(merchant.score)) : undefined} label="Merchant score"
            hint={merchant ? `${merchant.totalCalls} calls, ${merchant.failedCalls} failed` : undefined} />
          {merchant?.score != null && <Gauge pct={merchant.score} />}
        </div>
      </section>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[300px_1fr_320px]">
        <aside className="panel space-y-5 self-start">
          <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Pick a merchant</h2>
          {merchants.isError && !merchants.data ? <LoadError what="the merchant catalog" retry={() => merchants.refetch()} />
            : merchants.isLoading ? <div className="space-y-2" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
            : list.length === 0 ? <p className="text-sm text-on-surface-variant">No merchants are in the catalog yet. Check back soon, or <Link className="text-on-surface underline decoration-outline underline-offset-4 hover:text-primary" href="/merchant/setup">list your own API</Link>.</p>
            : categories.map((cat) => (
              <div key={cat} role="group" aria-label={cat} className="space-y-1.5">
                <div className="px-1 text-xs text-on-surface-variant" aria-hidden>{cat}</div>
                {list.filter((m) => m.category === cat).map((m) => {
                  const on = slug === m.slug;
                  return (
                    <button key={m.id} type="button" onClick={() => { setSlug(m.slug); setRun(null); }} aria-pressed={on}
                      className={cx("flex min-h-12 w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors", on ? "bg-surface-container-high" : "bg-surface-container-low hover:bg-surface-container")}>
                      <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", on ? "bg-primary text-on-primary" : "bg-surface-container-high")} aria-hidden>{on && <Check className="h-3 w-3" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="money shrink-0 text-xs text-on-surface-variant">{usdc(m.price)}&nbsp;USDC</span>
                        </span>
                        {m.description && <span className="mt-0.5 block text-xs text-on-surface-variant">{m.description}</span>}
                        {!m.covered && <span className="pill pill-warn mt-1.5">Not covered</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          <button className="btn-primary w-full" disabled={mutation.isPending || !slug} onClick={pay} aria-busy={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {mutation.isPending ? "Paying…" : merchant ? `Pay ${merchant.name}` : "Pay a merchant"}
          </button>
          {mutation.isError && (
            <ErrorCard error={mutation.error} offline={OFFLINE} onRetry={pay}
              extra={<TechDetails label="For developers">The sandbox talks to the demo agent service (apps/demo-agent, port 4200 by default) through /demo-agent. Start it with npm run dev -w apps/demo-agent, then try again.</TechDetails>} />
          )}
        </aside>

        <RunView run={run} pending={mutation.isPending} />
      </div>
    </div>
  );
}

function Figure({ value, unit, label, hint, flush, loading }: { value?: string; unit?: string; label: string; hint?: React.ReactNode; flush?: boolean; loading?: boolean }) {
  return (
    <div className={cx("min-w-0", !flush && "sm:pl-6 sm:first:pl-0")}>
      <div className="money truncate font-display text-2xl font-semibold leading-tight">
        {value ?? (loading ? <span className="skeleton inline-block h-7 w-24 rounded-lg align-middle" aria-hidden /> : <span className="text-on-surface-variant">–</span>)}
        {unit && <span className="ml-1.5 text-xs font-normal text-on-surface-variant">{unit}</span>}
      </div>
      <div className="mt-1 text-sm text-on-surface-variant">{label}</div>
      {hint && <div className="mt-1 truncate text-xs text-outline">{hint}</div>}
    </div>
  );
}
