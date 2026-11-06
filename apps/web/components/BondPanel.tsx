"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEPOSIT_ERROR_TEXT, formatUsdc, hashscanTx } from "@app/shared";
import { ApiError, HASHSCAN, get, isStepUp, post, startStepUp, takePendingStepUp, type Bond, type MerchantMe } from "@/lib/api";
import { Alert, Badge, CopyButton, Money, TxLink, cx, fmtTime, microFromInput } from "@/lib/ui";
import { LoadError, usdc } from "@/components/owner/kit";
import { reasonText } from "@/lib/world";

/** The merchant's bond: what it can refund, how to top it up, how to take it back, and every movement. */
export function BondPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const bond = useQuery({ queryKey: ["bond", merchantId], queryFn: () => get<Bond>(`/api/merchants/${merchantId}/bond`), refetchInterval: 5000 });
  const [txId, setTxId] = useState("");
  const [txInvalid, setTxInvalid] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const deposit = useMutation({
    mutationFn: () => post<{ credited: string }>(`/api/merchants/${merchantId}/bond/deposits`, { txId: txId.trim() }),
    onSuccess: (r) => { setMsg({ tone: "green", text: `Credited ${formatUsdc(r.credited)} to your bond.` }); setTxId(""); qc.invalidateQueries({ queryKey: ["bond", merchantId] }); qc.invalidateQueries({ queryKey: ["merchant-me"] }); },
    onError: (e) => setMsg({ tone: "red", text: e instanceof ApiError ? DEPOSIT_ERROR_TEXT[e.code] ?? DEPOSIT_FALLBACK[e.code] ?? "Couldn't confirm this deposit. Check the transaction id and try again." : "Couldn't confirm this deposit. Check your connection and try again." }),
  });
  const confirmDeposit = () => {
    if (deposit.isPending) return;
    if (!TX_ID.test(txId.trim())) { setTxInvalid(true); document.getElementById("deposit-tx")?.focus(); return; }
    setMsg(null);
    deposit.mutate();
  };

  if (!bond.data) {
    if (bond.isError) return <LoadError what="your bond" retry={() => bond.refetch()} />;
    return (
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <div className="skeleton h-72 lg:col-span-7" /><div className="skeleton h-72 lg:col-span-5" />
        <div className="skeleton h-64 lg:col-span-12" />
      </div>
    );
  }
  const b = bond.data;
  const low = b.failuresCovered < 3;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <section className="panel lg:col-span-7">
          <PanelHead title="Available for refunds" sub="Refunds agents automatically when a call to your API fails."
            aside={<Badge tone={b.covered ? "green" : "amber"}>{b.covered ? "Covering calls" : "Below minimum"}</Badge>} />
          <div className="mt-8">
            <div className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{usdc(b.available)}</div>
            <div className="mt-2 text-sm text-on-surface-variant">USDC available to refund agents</div>
          </div>
          <BondBar bond={b} />
          {low && <div className="mt-5"><Alert tone="amber">Your bond covers fewer than 3 failed calls. When it runs out, agents are blocked from paying you. Top it up below.</Alert></div>}
        </section>

        <section className="panel lg:col-span-5">
          <dl className="divide-y divide-rule">
            <Row warn={low} value={String(b.failuresCovered)} unit={b.failuresCovered === 1 ? "failure" : "failures"} label="Your bond still covers" />
            <Row value={usdc(b.perFailure)} unit="USDC" label="Refunded per failed call" />
            <Row value={usdc(b.balance)} unit="USDC" label="Total in the vault" />
            <Row value={usdc(b.locked)} unit="USDC" label="Held for calls in progress" />
          </dl>
        </section>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <section className="panel lg:col-span-7">
          <PanelHead title="Top up" sub="Send USDC from any Hedera wallet, such as HashPack, to the vault with this memo. Then paste the transaction id." />
          <div className="mt-5 space-y-2">
            <MonoRow label="Vault account" value={b.vaultAccount} href={`${HASHSCAN}/account/${b.vaultAccount}`} copyLabel="Copy vault account" />
            <MonoRow label="Token" value={b.token} note="USDC" copyLabel="Copy token id" />
            <MonoRow label="Memo" value={b.memo} note="Must match exactly" warn copyLabel="Copy memo" />
          </div>
          <form className="mt-5" noValidate onSubmit={(e) => { e.preventDefault(); confirmDeposit(); }}>
            <label className="label" htmlFor="deposit-tx">Transaction id</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id="deposit-tx" className="input font-mono text-[13px]" placeholder="0.0.12345@1700000000.123456789" autoComplete="off" spellCheck={false}
                value={txId} aria-invalid={txInvalid || undefined} aria-describedby="deposit-tx-hint"
                onChange={(e) => { setTxId(e.target.value); setTxInvalid(false); setMsg(null); }}
                onBlur={() => setTxInvalid(txId.trim() !== "" && !TX_ID.test(txId.trim()))} />
              <button type="submit" className="btn-primary whitespace-nowrap" disabled={!txId.trim() || deposit.isPending}>{deposit.isPending ? "Confirm deposit…" : "Confirm deposit"}</button>
            </div>
            <p id="deposit-tx-hint" className={cx("mt-2 text-xs", txInvalid ? "text-bad" : "text-outline")}>
              {txInvalid ? "That isn't a Hedera transaction id. " : ""}Either form works: <span className="font-mono break-all">0.0.12345@1700000000.123456789</span> or <span className="font-mono break-all">0.0.12345-1700000000-123456789</span>.
            </p>
          </form>
          {deposit.isPending && <p role="status" className="mt-2 text-xs text-on-surface-variant">Checking the transaction on Hedera…</p>}
          {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        </section>

        <WithdrawCard merchantId={merchantId} bond={b} />
      </div>

      <section className="panel">
        <PanelHead title="Bond activity" sub="Every deposit, refund to an agent and withdrawal." />
        {!b.ledger || b.ledger.length === 0 ? (
          <p className="py-12 text-center text-sm text-on-surface-variant">No bond activity yet. Your first deposit shows up here.</p>
        ) : (
          <div className="-mx-2 mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-on-surface-variant">
                <th className="px-2 pb-3 font-normal">When</th><th className="px-2 pb-3 font-normal">Type</th><th className="px-2 pb-3 font-normal">Payment</th>
                <th className="px-2 pb-3 font-normal">Transaction</th><th className="px-2 pb-3 text-right font-normal">USDC</th>
              </tr></thead>
              <tbody>{b.ledger.map((l) => {
                const t = LEDGER[l.type] ?? { label: l.type, tone: "grey", sign: "" };
                const amt = Math.abs(l.amount);
                return (
                  <tr key={l.id} className="border-t border-rule">
                    <td className="whitespace-nowrap px-2 py-3 text-on-surface-variant">{fmtTime(l.createdAt)}</td>
                    <td className="px-2 py-3"><Badge tone={t.tone}>{t.label}</Badge></td>
                    <td className="px-2 py-3">{l.paymentId ? <Link href={`/receipts/${l.paymentId}`} className="text-on-surface-variant underline decoration-outline underline-offset-4 hover:text-on-surface">Receipt</Link> : <span className="text-outline">–</span>}</td>
                    <td className="px-2 py-3">{l.txId ? <TxLink href={l.txId.includes("@") ? hashscanTx(l.txId, HASHSCAN) : `${HASHSCAN}/transaction/${l.txId}`} label="HashScan" /> : <span className="text-outline">Seeded</span>}</td>
                    <td className="money whitespace-nowrap px-2 py-3 text-right font-medium">{t.sign}{usdc(amt)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Both forms the gateway accepts: the SDK's 0.0.1@seconds.nanos and the mirror node's 0.0.1-seconds-nanos. */
const TX_ID = /^0\.0\.\d+(@\d+\.\d+|-\d+-\d+)$/;
const DEPOSIT_FALLBACK: Record<string, string> = {
  invalid_input: "That isn't a Hedera transaction id. Paste it in one of the two forms below.",
  not_found: "Your service couldn't be found. Reload the page and try again.",
};

const LEDGER: Record<string, { label: string; tone: string; sign: string }> = {
  deposit: { label: "Deposit", tone: "green", sign: "+" },
  slash: { label: "Refund to agent", tone: "red", sign: "−" },
  withdraw: { label: "Withdrawal", tone: "blue", sign: "−" },
};

/**
 * The bond as one bar. Solid grey is held for calls in progress, lime is free to refund agents,
 * stripes are what's still missing to reach the minimum. The tick marks the minimum.
 */
function BondBar({ bond }: { bond: Bond }) {
  const locked = Number(bond.locked), available = Number(bond.available), min = Number(bond.minimum);
  const scale = Math.max(locked + available, min, 1) * 1.08;
  const pct = (v: number) => (v / scale) * 100;
  const short = Math.max(0, min - locked - available);
  return (
    <div className="mt-8">
      <div className="relative h-14 overflow-hidden rounded-full bg-surface-container-low" role="img" aria-label={`${usdc(locked)} USDC held, ${usdc(available)} USDC available, minimum ${usdc(min)} USDC`}>
        <div className="flex h-full">
          {locked > 0 && <div className="h-full bg-surface-container-high" style={{ width: `${pct(locked)}%` }} />}
          {available > 0 && <div className={cx("h-full rounded-r-full", bond.covered ? "bg-primary" : "bg-warn")} style={{ width: `${pct(available)}%` }} />}
          {short > 0 && <div className="hatch h-full" style={{ width: `${pct(short)}%` }} />}
        </div>
        {min > 0 && <div className="absolute inset-y-2 w-1 -translate-x-1/2 rounded-full bg-on-surface shadow-[0_0_0_2px_var(--color-surface-container-lowest)]" style={{ left: `${pct(min)}%` }} aria-hidden />}
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Legend swatch="h-3 w-3 bg-surface-container-high" label="Held" value={bond.locked} />
        <Legend swatch={cx("h-3 w-3", bond.covered ? "bg-primary" : "bg-warn")} label="Available" value={bond.available} />
        <Legend swatch="h-3 w-1 bg-on-surface" label="Minimum to stay live" value={bond.minimum} />
        {short > 0 && <Legend swatch="hatch h-3 w-3" label="Missing" value={short} />}
      </dl>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx("shrink-0 rounded-full", swatch)} aria-hidden />
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="money font-medium">{usdc(value)}</dd>
    </div>
  );
}

const WITHDRAW_ERRORS: Record<string, string> = {
  insufficient_available: "That is more than the available bond. Money held for calls in progress cannot be withdrawn.",
  transfer_failed: "The Hedera transfer failed, so nothing was withdrawn. Try again in a minute.",
  suspended: "Suspended merchants cannot withdraw their bond.",
};

/** Withdraw the unreserved bond. Needs a fresh World ID check, then finishes the withdrawal on return. */
function WithdrawCard({ merchantId, bond }: { merchantId: string; bond: Bond }) {
  const qc = useQueryClient();
  const params = useSearchParams();
  const merchant = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me") });
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: React.ReactNode } | null>(null);
  const scope = `merchant:${merchantId}:withdraw`;

  const withdraw = useMutation({
    mutationFn: (micro: number) => post<{ withdrawn: string; txId: string }>(`/api/merchants/${merchantId}/bond/withdraw`, { amount: micro }),
    onSuccess: (r) => {
      setAmount("");
      setMsg({ tone: "green", text: <>Withdrew <Money micro={r.withdrawn} /> to your payout account. <TxLink href={hashscanTx(r.txId, HASHSCAN)} label="View on HashScan" /></> });
      qc.invalidateQueries({ queryKey: ["bond", merchantId] }); qc.invalidateQueries({ queryKey: ["merchant-me"] });
    },
    onError: (e, micro) => isStepUp(e)
      ? startStepUp(e.body.scope, "/merchant/bond", { amount: micro })
      : setMsg({ tone: "red", text: e instanceof ApiError ? WITHDRAW_ERRORS[e.code] ?? "Couldn't withdraw. Check your connection and try again." : "Couldn't withdraw. Check your connection and try again." }),
  });

  // Back from the World ID check: finish the withdrawal the merchant asked for, once.
  const stepup = params.get("stepup");
  useEffect(() => {
    if (!stepup) return;
    window.history.replaceState(null, "", "/merchant/bond");
    if (stepup === "ok" && params.get("scope") === scope) {
      const p = takePendingStepUp<{ amount: number }>(scope);
      if (p) withdraw.mutate(p.amount);
    } else if (stepup === "denied") {
      setMsg({ tone: "red", text: `${reasonText(params.get("reason"))} Nothing was withdrawn.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepup]);

  const available = Number(bond.available);
  const submit = () => {
    setMsg(null);
    try {
      const micro = microFromInput(amount);
      if (micro <= 0) throw new Error("Enter an amount above zero.");
      if (micro > available) throw new Error("That is more than the available bond.");
      withdraw.mutate(micro);
    } catch (err) { setMsg({ tone: "red", text: (err as Error).message }); }
  };
  const belowMin = (() => { try { return available - microFromInput(amount) < Number(bond.minimum); } catch { return false; } })();

  return (
    <section className="panel lg:col-span-5">
      <PanelHead title="Withdraw" sub="Send part of your bond back to your payout account. You'll confirm with World ID first." />
      {merchant.data && (
        <div className="well mt-5 flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
          <span className="text-on-surface-variant">Pays out to</span>
          <span className="font-mono text-[13px]">{merchant.data.payoutAccountId}</span>
        </div>
      )}
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (amount && !withdraw.isPending && available > 0) submit(); }}>
        <label className="label" htmlFor="withdraw-amount">Amount in USDC</label>
        <div className="relative">
          <input id="withdraw-amount" className="input money pr-20" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setMsg(null); }} />
          <button className="btn-ghost absolute right-1.5 top-1/2 h-8 min-h-8 -translate-y-1/2 px-3 py-0 text-sm after:absolute after:-inset-1" type="button" onClick={() => { setAmount((available / 1e6).toString()); setMsg(null); }}>Max</button>
        </div>
        <p className="money text-xs text-outline">Up to {usdc(available)} USDC. Money held for calls in progress stays in the vault.</p>
        <button type="submit" className="btn-secondary w-full" disabled={!amount || withdraw.isPending || available <= 0}>{withdraw.isPending ? "Withdraw bond…" : "Withdraw bond"}</button>
      </form>
      {amount && belowMin && <div className="mt-3"><Alert tone="amber">This takes your bond below the minimum (<Money micro={bond.minimum} />). Your service stops taking calls until you top it up again.</Alert></div>}
      {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
    </section>
  );
}

/** A value to copy into a wallet. The well's radius is the copy button's (18px) plus its 6px inset. */
function MonoRow({ label, value, href, note, warn, copyLabel }: { label: string; value: string; href?: string; note?: string; warn?: boolean; copyLabel: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[24px] bg-surface-container-low py-1.5 pl-4 pr-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-on-surface-variant">{label}{note && <span className={cx("ml-2", warn ? "text-warn" : "text-outline")}>{note}</span>}</div>
        <div className="break-all font-mono text-[13px]">
          {href ? <a className="underline decoration-outline underline-offset-4 hover:decoration-on-surface" href={href} target="_blank" rel="noreferrer">{value}</a> : value}
        </div>
      </div>
      <CopyButton text={value} label={copyLabel} />
    </div>
  );
}

function PanelHead({ title, sub, aside }: { title: string; sub?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">{title}</h2>
        {sub && <p className="mt-0.5 max-w-md text-sm text-on-surface-variant">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

function Row({ value, unit, label, warn }: { value: string; unit?: string; label: string; warn?: boolean }) {
  return (
    <div className="flex flex-col-reverse py-4 first:pt-0 last:pb-0">
      <dt className="mt-1 text-sm text-on-surface-variant">{label}</dt>
      <dd className={cx("money font-display text-2xl font-semibold leading-tight", warn && "text-warn")}>{value}{unit && <span className="ml-1.5 text-sm font-normal text-on-surface-variant">{unit}</span>}</dd>
    </div>
  );
}
