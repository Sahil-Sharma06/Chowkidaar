"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { PublicStats } from "@app/shared";
import { get } from "@/lib/api";
import { Money, Stat } from "@/lib/ui";

const STEPS = [
  ["Agent pays", "The agent pays the price plus a small protection fee to the gateway over x402."],
  ["We check the response", "Status, timeout, empty body, JSON format and the merchant's own schema. Objective checks only."],
  ["Delivered or refunded", "Pass: the agent gets the data. Fail: the agent is refunded from the merchant's bond and the bond is slashed."],
  ["Recorded on Hedera", "Every payment, refund and receipt is on the Hedera ledger. Merchant reputation is public on Arkiv."],
];

export default function Landing() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => get<PublicStats>("/api/public/stats"), refetchInterval: 10_000 });
  return (
    <div className="space-y-12">
      <section className="space-y-5 pt-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Let your agent spend without watching every payment.</h1>
        <p className="mx-auto max-w-2xl text-lg text-slate-600">If a service fails, your agent gets its money back from the merchant&apos;s bond.</p>
        <div className="flex justify-center gap-3">
          <Link href="/demo" className="btn-primary">See it live</Link>
          <Link href="/login" className="btn-secondary">Get started</Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Protected calls" value={stats.data?.protectedCalls ?? "—"} />
        <Stat label="Refunds" value={stats.data?.refunds ?? "—"} />
        <Stat label="USDC refunded" value={stats.data ? <Money micro={stats.data.usdcRefunded} /> : "—"} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="card">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{i + 1}</div>
              <div className="font-medium">{t}</div>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card text-sm text-slate-600">
        <strong className="text-slate-800">What we check, and what we can&apos;t.</strong> We check for errors, timeouts, empty and malformed responses. We can&apos;t judge whether valid-looking data is useful. It is a bond-backed guarantee, not insurance.
      </section>
    </div>
  );
}
