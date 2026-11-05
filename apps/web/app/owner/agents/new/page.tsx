"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, GATEWAY_URL, post, type AgentRow } from "@/lib/api";
import { Alert, CopyButton, Field, microFromInput } from "@/lib/ui";

export default function NewAgentPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", hederaAccountId: "", perCallCap: "0.50", dailyCap: "5", approvalThreshold: "0.25", minScore: "80" });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AgentRow | null>(null);

  const m = useMutation({
    mutationFn: () => post<AgentRow>("/api/agents", {
      name: f.name, hederaAccountId: f.hederaAccountId, perCallCap: microFromInput(f.perCallCap), dailyCap: microFromInput(f.dailyCap),
      approvalThreshold: microFromInput(f.approvalThreshold), minScore: Number(f.minScore),
    }),
    onSuccess: (a) => { setCreated(a); qc.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e) => setError(e instanceof ApiError ? (e.code === "hedera_account_in_use" ? "That Hedera account is already registered to an agent." : JSON.stringify(e.body)) : String(e)),
  });

  if (created) {
    const snippet = `const res = await payFetch("${GATEWAY_URL}/v1/call/MERCHANT_SLUG", {\n  method: "POST",\n  headers: { "content-type": "application/json", "x-agent-key": "${created.apiKey}" },\n  body: JSON.stringify({ /* your request */ }),\n});`;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Agent created</h1>
        <Alert tone="amber">Copy the API key now. <strong>You won&apos;t see this again.</strong></Alert>
        <div className="card flex items-center justify-between gap-2"><code className="break-all text-sm">{created.apiKey}</code><CopyButton text={created.apiKey ?? ""} /></div>
        <div className="card"><div className="mb-2 flex items-center justify-between"><span className="label mb-0">Connection snippet</span><CopyButton text={snippet} /></div><pre className="overflow-x-auto text-xs">{snippet}</pre></div>
        <p className="text-sm text-slate-600">Next, allow merchants on the agent page so it can pay them.</p>
        <Link className="btn-primary" href={`/owner/agents/${created.id}`}>Open agent</Link>
      </div>
    );
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mx-auto max-w-xl space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); try { m.mutate(); } catch (err) { setError(String(err)); } }}>
      <h1 className="text-2xl font-semibold">Create agent</h1>
      <div className="card space-y-4">
        <Field label="Name"><input className="input" required minLength={2} maxLength={40} value={f.name} onChange={set("name")} /></Field>
        <Field label="Hedera account" hint="The account your agent pays from, e.g. 0.0.12345. It must hold testnet USDC."><input className="input" required pattern="0\.0\.\d+" value={f.hederaAccountId} onChange={set("hederaAccountId")} placeholder="0.0.12345" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Per-call cap (USDC)"><input className="input" value={f.perCallCap} onChange={set("perCallCap")} /></Field>
          <Field label="Daily cap (USDC)"><input className="input" value={f.dailyCap} onChange={set("dailyCap")} /></Field>
          <Field label="Approval above (USDC)" hint="Calls above this need your approval first."><input className="input" value={f.approvalThreshold} onChange={set("approvalThreshold")} /></Field>
          <Field label="Minimum merchant score"><input className="input" type="number" min={0} max={100} value={f.minScore} onChange={set("minScore")} /></Field>
        </div>
        {error && <Alert tone="red">{error}</Alert>}
        <button className="btn-primary" disabled={m.isPending}>Create agent</button>
      </div>
    </form>
  );
}
