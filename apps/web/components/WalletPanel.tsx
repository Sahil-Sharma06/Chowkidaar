"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { formatUsdc } from "@app/shared";
import { get, post, HASHSCAN, MIRROR_URL, USDC_ID, type Config } from "@/lib/api";
import { Alert, TxLink } from "@/lib/ui";

/** Live balances straight from the mirror node, so what we show is what the chain says. */
export function useWallet(accountId: string | undefined) {
  return useQuery({
    queryKey: ["wallet", accountId],
    enabled: Boolean(accountId),
    refetchInterval: 6000,
    queryFn: async () => {
      const [a, t] = await Promise.all([
        fetch(`${MIRROR_URL}/api/v1/accounts/${accountId}`).then((r) => (r.ok ? r.json() : null)) as Promise<{ balance: { balance: number } } | null>,
        fetch(`${MIRROR_URL}/api/v1/accounts/${accountId}/tokens?token.id=${USDC_ID}`).then((r) => (r.ok ? r.json() : null)) as Promise<{ tokens: { balance: number }[] } | null>,
      ]);
      return { hbar: (a?.balance?.balance ?? 0) / 1e8, usdcMicro: t?.tokens?.[0]?.balance ?? 0 };
    },
  });
}

type Scheduled = { scheduleId: string; amount: number; executeAt: number };
const EVERY = [["120", "2 minutes (demo)"], ["3600", "hour"], ["86400", "day"], ["604800", "week"]] as const;

export function WalletPanel({ agentId, accountId, custodial, compact, scheduled = [] }: { agentId: string; accountId: string; custodial: boolean; compact?: boolean; scheduled?: Scheduled[] }) {
  const qc = useQueryClient();
  const w = useWallet(accountId);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const [funded, setFunded] = useState<string | null>(null);
  const fund = useMutation({
    mutationFn: () => post<{ amount: number; txId: string }>(`/api/agents/${agentId}/fund`),
    onSuccess: (r) => { setFunded(r.txId); setTimeout(() => qc.invalidateQueries({ queryKey: ["wallet", accountId] }), 4000); },
  });
  const [sched, setSched] = useState({ amount: "0.5", everySec: "120", times: "2" });
  const schedule = useMutation({
    mutationFn: () => post<{ created: Scheduled[] }>(`/api/agents/${agentId}/fund/schedule`, { amount: Math.round(Number(sched.amount) * 1e6), everySec: Number(sched.everySec), times: Number(sched.times) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent", agentId] }),
  });
  const now = Date.now();

  return (
    <section className={compact ? "space-y-2 rounded-lg bg-surface-container-low p-3" : "card space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-secondary" /><span className="text-sm font-semibold">Agent wallet</span></div>
        <a className="font-mono text-xs text-secondary hover:underline" href={`${HASHSCAN}/account/${accountId}`} target="_blank" rel="noreferrer">{accountId}</a>
      </div>
      <div className="flex items-baseline gap-4">
        <div><div className="label mb-0">USDC</div><div className="money text-xl font-semibold">{w.data ? formatUsdc(w.data.usdcMicro).replace(/ USDC$/, "") : "—"}</div></div>
        <div><div className="label mb-0">HBAR (fees)</div><div className="money text-sm">{w.data ? w.data.hbar.toFixed(2) : "—"}</div></div>
        <div className="ml-auto text-xs text-on-surface-variant">{custodial ? "Custodial: the gateway holds this key" : "Your own account"}</div>
      </div>
      {custodial && cfg.data?.features.demoMode && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={fund.isPending} onClick={() => fund.mutate()}>
            {fund.isPending ? "Sending…" : "Fund 0.5 USDC from the gateway (testnet)"}
          </button>
          {funded && <span>Sent · <TxLink id={funded} label="HashScan" /></span>}
          {fund.isError && <span className="text-error">Funding failed. Is the gateway out of testnet USDC?</span>}
        </div>
      )}
      {custodial && cfg.data?.features.demoMode && !compact && (
        <div className="space-y-2 rounded-lg bg-surface-container-low p-3 text-xs">
          <div className="font-semibold">Scheduled top-ups <span className="font-normal text-on-surface-variant">· Hedera Scheduled Transactions: the network moves the USDC at each time, even if this gateway is down.</span></div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); schedule.mutate(); }}>
            <input className="input w-20" value={sched.amount} onChange={(e) => setSched({ ...sched, amount: e.target.value })} aria-label="USDC per top-up" /> USDC every
            <select className="input w-auto" value={sched.everySec} onChange={(e) => setSched({ ...sched, everySec: e.target.value })} aria-label="Interval">{EVERY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            × <input className="input w-14" type="number" min={1} max={8} value={sched.times} onChange={(e) => setSched({ ...sched, times: e.target.value })} aria-label="Times" />
            <button type="submit" className="btn-secondary px-3 py-1.5 text-xs" disabled={schedule.isPending}>{schedule.isPending ? "Scheduling…" : "Schedule"}</button>
            {schedule.isError && <span className="text-error">Could not schedule. Amount 0.1–5 USDC, at most 62 days ahead.</span>}
          </form>
          {scheduled.length > 0 && (
            <ul className="space-y-1">
              {scheduled.map((s) => (
                <li key={s.scheduleId} className="flex flex-wrap items-center gap-2">
                  <span className={s.executeAt <= now ? "text-on-surface-variant" : ""}>{s.executeAt <= now ? "Fired" : "Fires"} {new Date(s.executeAt).toLocaleString()}</span>
                  <span className="money">{formatUsdc(s.amount)}</span>
                  <a className="font-mono text-secondary hover:underline" href={`${HASHSCAN}/schedule/${s.scheduleId}`} target="_blank" rel="noreferrer">{s.scheduleId}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!compact && (
        <Alert tone="blue">Or send testnet USDC ({USDC_ID}) to <span className="font-mono">{accountId}</span> yourself, e.g. from faucet.circle.com. Every call also needs a little HBAR for fees; the wallet was created with 1 HBAR.</Alert>
      )}
    </section>
  );
}
