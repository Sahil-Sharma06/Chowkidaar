"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, GATEWAY_URL, HASHSCAN, post, type AgentRow } from "@/lib/api";
import { Alert, CopyButton, Field, cx, microFromInput } from "@/lib/ui";

export default function NewAgentPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", hederaAccountId: "", perCallCap: "0.50", dailyCap: "5", approvalThreshold: "0.25", minScore: "60" });
  const [wallet, setWallet] = useState<"custodial" | "own">("custodial");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AgentRow | null>(null);

  const m = useMutation({
    mutationFn: () => post<AgentRow>("/api/agents", {
      name: f.name, ...(wallet === "own" ? { hederaAccountId: f.hederaAccountId } : {}),
      perCallCap: microFromInput(f.perCallCap), dailyCap: microFromInput(f.dailyCap),
      approvalThreshold: microFromInput(f.approvalThreshold), minScore: Number(f.minScore),
    }),
    onSuccess: (a) => { setCreated(a); qc.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e) => setError(e instanceof ApiError
      ? (e.code === "hedera_account_in_use" ? "That Hedera account is already registered to an agent." : e.code === "wallet_create_failed" ? "Could not create the wallet on Hedera. Try again in a moment." : JSON.stringify(e.body))
      : String(e)),
  });

  if (created) {
    const snippet = `const res = await payFetch("${GATEWAY_URL}/v1/call/MERCHANT_SLUG", {\n  method: "POST",\n  headers: { "content-type": "application/json", "x-agent-key": "${created.apiKey}" },\n  body: JSON.stringify({ /* your request */ }),\n});`;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-2xl font-semibold">Agent created</h1>
        {created.custodial && (
          <Alert tone="green">
            Wallet created on Hedera: <a className="font-mono underline" href={`${HASHSCAN}/account/${created.hederaAccountId}`} target="_blank" rel="noreferrer">{created.hederaAccountId}</a>.
            Fund it with testnet USDC and pay from the playground.
          </Alert>
        )}
        <Alert tone="amber">Copy the API key now. <strong>You won&apos;t see this again.</strong>{created.custodial && " (The playground keeps its own copy for this agent.)"}</Alert>
        <div className="card flex items-center justify-between gap-2"><code className="break-all text-sm">{created.apiKey}</code><CopyButton text={created.apiKey ?? ""} /></div>
        <div className="card"><div className="mb-2 flex items-center justify-between"><span className="label mb-0">Connection snippet</span><CopyButton text={snippet} /></div><pre className="overflow-x-auto text-xs">{snippet}</pre></div>
        <p className="text-sm text-on-surface-variant">Next, allow merchants on the agent page so it can pay them.</p>
        <div className="flex gap-3">
          <Link className="btn-primary" href={`/owner/agents/${created.id}`}>Open agent</Link>
          {created.custodial && <Link className="btn-secondary" href="/playground">Go to playground</Link>}
        </div>
      </div>
    );
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); try { m.mutate(); } catch (err) { setError(String(err)); } }}>
      <h1 className="font-display text-2xl font-semibold">Create agent</h1>
      <div className="card space-y-4">
        <Field label="Name"><input className="input" required minLength={2} maxLength={40} value={f.name} onChange={set("name")} /></Field>
        <div>
          <div className="label">Wallet</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["custodial", "Create one for me", "A new Hedera testnet account. The gateway keeps its key so you can pay from the playground."], ["own", "Use my own account", "Your agent pays with its own key from your code. The gateway never sees it."]] as const).map(([k, t, d]) => (
              <button key={k} type="button" onClick={() => setWallet(k)} className={cx("rounded-lg border p-3 text-left text-sm", wallet === k ? "border-secondary bg-secondary-container/20" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low")}>
                <div className="font-medium">{t}</div><div className="text-xs text-on-surface-variant">{d}</div>
              </button>
            ))}
          </div>
        </div>
        {wallet === "own" && <Field label="Hedera account" hint="The account your agent pays from, e.g. 0.0.12345. It must hold testnet USDC."><input className="input" required pattern="0\.0\.\d+" value={f.hederaAccountId} onChange={set("hederaAccountId")} placeholder="0.0.12345" /></Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Per-call cap (USDC)"><input className="input" value={f.perCallCap} onChange={set("perCallCap")} /></Field>
          <Field label="Daily cap (USDC)"><input className="input" value={f.dailyCap} onChange={set("dailyCap")} /></Field>
          <Field label="Approval above (USDC)" hint="Calls above this need your approval first."><input className="input" value={f.approvalThreshold} onChange={set("approvalThreshold")} /></Field>
          <Field label="Minimum merchant score" hint="Merchants with fewer than 5 calls count as new and are allowed."><input className="input" type="number" min={0} max={100} value={f.minScore} onChange={set("minScore")} /></Field>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        <button className="btn-primary" disabled={m.isPending}>{m.isPending ? (wallet === "custodial" ? "Creating wallet on Hedera…" : "Creating…") : "Create agent"}</button>
      </div>
    </form>
  );
}
