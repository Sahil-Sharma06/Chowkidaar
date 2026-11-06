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

export function WalletPanel({ agentId, accountId, custodial, compact }: { agentId: string; accountId: string; custodial: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const w = useWallet(accountId);
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const [funded, setFunded] = useState<string | null>(null);
  const fund = useMutation({
    mutationFn: () => post<{ amount: number; txId: string }>(`/api/agents/${agentId}/fund`),
    onSuccess: (r) => { setFunded(r.txId); setTimeout(() => qc.invalidateQueries({ queryKey: ["wallet", accountId] }), 4000); },
  });

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
      {!compact && (
        <Alert tone="blue">Or send testnet USDC ({USDC_ID}) to <span className="font-mono">{accountId}</span> yourself, e.g. from faucet.circle.com. Every call also needs a little HBAR for fees; the wallet was created with 1 HBAR.</Alert>
      )}
    </section>
  );
}
