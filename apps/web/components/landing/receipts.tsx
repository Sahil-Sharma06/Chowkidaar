"use client";
/** Proof: the latest calls through this gateway, live, each linking to its public receipt. */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PublicMerchant, PublicStats, Receipt } from "@app/shared";
import { StatusBadge, cx } from "@/lib/ui";
import { LoadError, ago, usdc } from "@/components/owner/kit";
import { EYEBROW, H2, LEAD, LINK, SECTION, WRAP } from "./sections";

const NBSP = " ";
const ROWS = 5;

export function Proof({ receipts, receiptsError, retry, merchants, stats }:
  { receipts?: Receipt[]; receiptsError: boolean; retry: () => void; merchants?: PublicMerchant[]; stats?: PublicStats }) {
  const rows = receipts?.slice(0, ROWS);
  const bonded = merchants?.filter((m) => Number(m.bondAvailable) > 0);
  const bond = bonded?.reduce((s, m) => s + Number(m.bondAvailable), 0);

  return (
    <section className={cx(WRAP, SECTION)} aria-labelledby="proof-h">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className={EYEBROW}>Receipts</p>
          <h2 id="proof-h" className={H2}>Every call gets a receipt</h2>
          <p className={cx(LEAD, "mt-5")}>
            Each one is written to Hedera, so anyone can check it.{" "}
            {bonded && bond !== undefined && bonded.length > 0 && (
              <>Right now <span className="money text-on-surface">{usdc(bond)}{NBSP}USDC</span> is bonded by <span className="money text-on-surface">{bonded.length}</span> {bonded.length === 1 ? "merchant" : "merchants"}.</>
            )}
          </p>
        </div>
        {stats && (
          <dl className="flex shrink-0 gap-10">
            <div><dt className="text-[13px] text-on-surface-variant">Calls checked</dt><dd className="money mt-1 text-2xl font-semibold tracking-[-0.02em]">{stats.protectedCalls.toLocaleString()}</dd></div>
            <div><dt className="text-[13px] text-on-surface-variant">Refunded</dt><dd className="money mt-1 text-2xl font-semibold tracking-[-0.02em]">{stats.refunds.toLocaleString()}</dd></div>
          </dl>
        )}
      </div>

      <div className="mt-12 overflow-hidden rounded-2xl border border-rule bg-surface-container-lowest shadow-[0_1px_2px_rgb(16_16_20/0.04)]">
        <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_140px_160px_150px] gap-4 border-b border-rule bg-surface-container-low/60 px-6 py-2.5 text-[12px] text-on-surface-variant sm:grid">
          <span>Merchant</span><span>When</span><span className="text-right">Amount</span><span className="text-right">Status</span>
        </div>
        {receiptsError && !rows ? <div className="p-5 sm:p-6"><LoadError what="the latest receipts" retry={retry} /></div>
          : !rows ? (
            <div className="space-y-2 p-4" aria-busy aria-label="Loading receipts">
              {Array.from({ length: ROWS }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-6 py-16 text-center text-[15px] text-on-surface-variant">
              <p>Receipts for every paid call show up here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-rule">
              {rows.map((r) => {
                const back = Number(r.money.refunded) > 0;
                return (
                  <li key={r.paymentId}>
                    <Link href={`/receipts/${r.paymentId}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-surface-container-low focus-visible:-outline-offset-2 sm:grid-cols-[minmax(0,1fr)_140px_160px_150px] sm:px-6">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.merchant.name}</span>
                        <span className="block truncate text-[13px] text-on-surface-variant">Paid by {r.agentName}</span>
                      </span>
                      <span className="hidden text-[13px] text-on-surface-variant sm:block">{ago(r.createdAt)}</span>
                      <span className="money row-span-2 flex flex-col items-end gap-1 text-sm sm:row-span-1 sm:block sm:text-right">
                        {back ? <span className="font-medium text-gain">+{usdc(r.money.refunded)}{NBSP}back</span> : <span>{usdc(r.money.agentPaid)}{NBSP}USDC</span>}
                        <span className="sm:hidden"><StatusBadge status={r.status} /></span>
                      </span>
                      <span className="hidden justify-end sm:flex"><StatusBadge status={r.status} /></span>
                      <span className="text-[12px] text-on-surface-variant sm:hidden">{ago(r.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        <div className="flex items-center justify-between gap-4 border-t border-rule px-5 py-3.5 text-sm sm:px-6">
          <span className="text-[13px] text-outline">Updates live</span>
          <Link href="/receipts" className={cx(LINK, "inline-flex items-center gap-1 no-underline hover:underline")}>
            See all receipts<ChevronRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
