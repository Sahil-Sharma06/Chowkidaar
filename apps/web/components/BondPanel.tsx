"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEPOSIT_ERROR_TEXT, hashscanTx } from "@app/shared";
import { ApiError, HASHSCAN, get, post, type Bond } from "@/lib/api";
import { Alert, CopyButton, Money, Stat, TxLink, fmtTime } from "@/lib/ui";

export function BondPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const bond = useQuery({ queryKey: ["bond", merchantId], queryFn: () => get<Bond>(`/api/merchants/${merchantId}/bond`), refetchInterval: 5000 });
  const [txId, setTxId] = useState("");
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const deposit = useMutation({
    mutationFn: () => post<{ credited: string }>(`/api/merchants/${merchantId}/bond/deposits`, { txId }),
    onSuccess: (r) => { setMsg({ tone: "green", text: `Credited ${(Number(r.credited) / 1e6).toFixed(6)} USDC.` }); setTxId(""); qc.invalidateQueries({ queryKey: ["bond", merchantId] }); qc.invalidateQueries({ queryKey: ["merchant-me"] }); },
    onError: (e) => setMsg({ tone: "red", text: e instanceof ApiError ? DEPOSIT_ERROR_TEXT[e.code] ?? e.code : String(e) }),
  });
  if (!bond.data) return <div className="text-sm text-slate-500">Loading bond…</div>;
  const b = bond.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Balance" value={<Money micro={b.balance} />} />
        <Stat label="Locked" value={<Money micro={b.locked} />} hint="Held during in-flight calls" />
        <Stat label="Available" value={<Money micro={b.available} />} hint={<>Minimum to go live: <Money micro={b.minimum} /></>} />
        <Stat label="Failures covered" value={b.failuresCovered} hint={<><Money micro={b.perFailure} /> per failure</>} />
      </div>
      {b.failuresCovered < 3 && <Alert tone="amber">Your bond can cover fewer than 3 failed calls. Agents will be blocked from paying you when it runs out.</Alert>}

      <div className="card space-y-3">
        <h3 className="font-semibold">Deposit</h3>
        <p className="text-sm text-slate-600">Send USDC from any Hedera wallet (HashPack, etc.) to the vault with the memo below, then paste the transaction id.</p>
        <Row label="Vault account" value={b.vaultAccount} href={`${HASHSCAN}/account/${b.vaultAccount}`} />
        <Row label="Token" value={`USDC ${b.token}`} />
        <Row label="Memo (required)" value={b.memo} warn />
        <div className="flex gap-2">
          <input className="input" placeholder="0.0.12345@1700000000.123456789 or 0.0.12345-1700000000-123456789" value={txId} onChange={(e) => setTxId(e.target.value)} />
          <button className="btn-primary whitespace-nowrap" disabled={!txId || deposit.isPending} onClick={() => deposit.mutate()}>Confirm deposit</button>
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>

      <div className="card overflow-x-auto p-0"><table className="table">
        <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Transaction</th></tr></thead>
        <tbody>
          {b.ledger?.map((l) => <tr key={l.id}><td className="text-xs">{fmtTime(l.createdAt)}</td><td className="capitalize">{l.type}</td><td><Money micro={l.amount} /></td><td>{l.txId ? <TxLink href={l.txId.includes("@") ? hashscanTx(l.txId, HASHSCAN) : `${HASHSCAN}/transaction/${l.txId}`} label="HashScan" /> : <span className="text-xs text-slate-400">seeded</span>}</td></tr>)}
          {b.ledger?.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">No deposits yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

function Row({ label, value, href, warn }: { label: string; value: string; href?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="flex items-center gap-1 font-mono">{href ? <a className="text-blue-700 hover:underline" href={href} target="_blank" rel="noreferrer">{value}</a> : value}{warn && <span className="ml-1 text-xs text-amber-700">must match exactly</span>}<CopyButton text={value} /></span>
    </div>
  );
}
