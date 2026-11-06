"use client";
import { useQuery } from "@tanstack/react-query";
import type { PublicMerchant, PublicStats, Receipt } from "@app/shared";
import { get, type Config } from "@/lib/api";
import type { AgentStatus } from "@/components/landing/payment";
import { Hero } from "@/components/landing/hero";
import { Bond, Close, Developers, Faq, HowItWorks, Rules, featured } from "@/components/landing/sections";
import { Proof } from "@/components/landing/receipts";

export default function Landing() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => get<PublicStats>("/api/public/stats"), refetchInterval: 8000 });
  const merchants = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), refetchInterval: 8000 });
  const receipts = useQuery({ queryKey: ["public-receipts", 40], queryFn: () => get<Receipt[]>("/api/public/receipts?limit=40"), refetchInterval: 4000 });
  const agent = useQuery({ queryKey: ["agent-status"], queryFn: () => get<AgentStatus>("/demo-agent/status"), refetchInterval: 10_000, retry: false });

  const c = cfg.data;
  const feeBps = c?.feeBps ?? 200;
  const penaltyBps = c?.penaltyBps ?? 2000;
  // The merchant we feature: a real, bonded one (never a failure demo), best rated first.
  const good = featured(merchants.data);
  const price = Number(good?.price ?? 100_000);
  const fee = Math.floor((price * feeBps) / 10_000);
  const penalty = Math.floor((price * penaltyBps) / 10_000);
  const latency = receipts.data?.find((r) => r.status === "delivered" && r.latencyMs != null)?.latencyMs;

  return (
    <div className="flex w-full flex-col">
      <Hero good={good} agent={agent.data} price={price} fee={fee} penalty={penalty} latency={latency} feeBps={feeBps} />
      <HowItWorks feeBps={feeBps} price={price} />
      <Rules />
      <Bond price={price} penalty={penalty} penaltyBps={penaltyBps} merchant={good} />
      <Proof receipts={receipts.data} receiptsError={receipts.isError} retry={() => receipts.refetch()} merchants={merchants.data} stats={stats.data} />
      <Developers slug={good?.slug ?? "<merchant>"} />
      <Faq feeBps={feeBps} penaltyBps={penaltyBps} />
      <Close />
    </div>
  );
}
