"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { formatUsdc } from "@app/shared";
import { ApiError, get, post, HASHSCAN, MIRROR_URL, USDC_ID, type Config } from "@/lib/api";
import { TxLink, cx } from "@/lib/ui";

type Wallet = { hbar: number; usdcMicro: number };

async function fetchWallet(accountId: string): Promise<Wallet> {
  const read = async <T,>(url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Mirror node answered ${r.status} for ${url}`);
    return (await r.json()) as T;
  };
  const [a, t] = await Promise.all([
    read<{ balance?: { balance?: number } }>(`${MIRROR_URL}/api/v1/accounts/${accountId}`),
    read<{ tokens?: { balance: number }[] }>(`${MIRROR_URL}/api/v1/accounts/${accountId}/tokens?token.id=${USDC_ID}`),
  ]);
  return { hbar: (a.balance?.balance ?? 0) / 1e8, usdcMicro: t.tokens?.[0]?.balance ?? 0 };
}

/**
 * Live balances straight from the mirror node, so what we show is what the chain says.
 * A mirror-node failure is an error (isError), never a zero balance.
 */
export function useWallet(accountId: string | undefined) {
  return useQuery({
    queryKey: ["wallet", accountId],
    enabled: Boolean(accountId),
    refetchInterval: 6000,
    queryFn: () => fetchWallet(accountId!),
  });
}

const FUND_ERROR: Record<string, string> = {
  fund_failed: "Couldn't send test USDC. The gateway may be out of testnet funds; try faucet.circle.com instead.",
  not_in_demo_mode: "Test top-ups are turned off on this gateway. Use faucet.circle.com instead.",
};

/**
 * The agent's wallet: the USDC it can spend, the HBAR it pays fees with, and (on testnet) a way to top it up.
 * `compact` drops the panel surface so it can sit inside another panel.
 */
export function WalletPanel({ agentId, accountId, custodial, compact }: { agentId: string; accountId: string; custodial: boolean; compact?: boolean }) {
  const w = useWallet(accountId);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });

  // After a top-up, watch the chain closely (every 2s, for up to 20s) until the balance moves.
  const [funded, setFunded] = useState<{ txId: string; amount: number; before: number | null; state: "waiting" | "landed" | "slow" } | null>(null);
  const watching = funded?.state === "waiting";
  useQuery({ queryKey: ["wallet", accountId], queryFn: () => fetchWallet(accountId), enabled: watching, refetchInterval: 2000 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!funded || funded.state !== "waiting" || !w.data) return;
    if (funded.before != null && w.data.usdcMicro !== funded.before) {
      setFunded({ ...funded, state: "landed" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFunded(null), 8000);
    }
  }, [w.data, funded]);

  const fund = useMutation({
    mutationFn: () => post<{ amount: number; txId: string }>(`/api/agents/${agentId}/fund`),
    onMutate: () => setFunded(null),
    onSuccess: (r) => {
      setFunded({ txId: r.txId, amount: r.amount, before: w.data?.usdcMicro ?? null, state: "waiting" });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFunded((f) => (f?.state === "waiting" ? { ...f, state: "slow" } : f)), 20_000);
    },
  });
  const canFund = custodial && cfg.data?.features.demoMode;
  const fundError = fund.error instanceof ApiError ? FUND_ERROR[fund.error.code] : undefined;

  return (
    <section className={cx(compact ? "space-y-4" : "panel space-y-5")} aria-busy={w.isLoading}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-on-surface-variant">{custodial ? "Agent wallet" : "Your account"}</span>
        <a className="inline-flex min-h-6 items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary" href={`${HASHSCAN}/account/${accountId}`} target="_blank" rel="noreferrer">
          {accountId} <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens HashScan)</span>
        </a>
      </div>

      {w.isError && !w.data ? (
        <div role="alert" className="space-y-3">
          <div>
            <div className="font-display text-2xl font-semibold leading-tight">Balance unavailable</div>
            <p className="mt-1 text-sm text-on-surface-variant">Couldn&apos;t reach the Hedera mirror node. Your funds are unaffected.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => w.refetch()} disabled={w.isFetching}>
            {w.isFetching ? "Checking…" : "Check again"}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            {w.data
              ? <span className="money font-display text-[40px] font-semibold leading-none tracking-[-0.02em]">{formatUsdc(w.data.usdcMicro).replace(/ USDC$/, "")}</span>
              : <span className="skeleton inline-block h-10 w-32 rounded-xl" aria-hidden />}
            <span className="text-sm text-on-surface-variant">USDC</span>
            {!w.data && <span className="sr-only">Loading balance</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1 text-sm text-on-surface-variant">
            Ready to spend, plus
            {w.data ? <span className="money text-on-surface">{w.data.hbar.toFixed(2)}</span> : <span className="skeleton inline-block h-4 w-10 rounded-md" aria-hidden />}
            HBAR for network fees
          </div>
        </div>
      )}

      {canFund && (
        <div className="space-y-2">
          <button type="button" className="btn-secondary" disabled={fund.isPending || watching} onClick={() => fund.mutate()}>
            {fund.isPending || watching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            {fund.isPending ? "Sending test USDC…" : watching ? "Waiting for Hedera…" : "Add 0.5 test USDC"}
          </button>
          <div role="status" className="text-xs text-on-surface-variant">
            {funded?.state === "waiting" && <>Sent. Waiting for the balance to update. <TxLink id={funded.txId} label="View on HashScan" /></>}
            {funded?.state === "landed" && <><span className="money text-gain">+{formatUsdc(funded.amount)}</span> added to the wallet. <TxLink id={funded.txId} label="View on HashScan" /></>}
            {funded?.state === "slow" && <>Sent, but the balance hasn&apos;t moved yet. It can take a minute to show. <TxLink id={funded.txId} label="View on HashScan" /></>}
          </div>
          {fund.isError && (
            <p role="alert" className="text-xs text-bad">{fundError ?? "Couldn't send test USDC. Check your connection and try again."}</p>
          )}
        </div>
      )}

      {!compact && (
        <p className="text-xs leading-relaxed text-outline">
          You can also send testnet USDC (<span className="font-mono">{USDC_ID}</span>) to <span className="font-mono">{accountId}</span> from faucet.circle.com.
          Each payment needs a little HBAR for fees; new wallets start with 1 HBAR.
        </p>
      )}
    </section>
  );
}
