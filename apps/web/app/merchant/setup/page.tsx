"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, get, patch, post, type MerchantMe } from "@/lib/api";
import { Alert, Badge, Field, cx, microFromInput, usdcInput } from "@/lib/ui";
import { BondPanel } from "@/components/BondPanel";

const EXAMPLE_SCHEMA = JSON.stringify({ type: "object", required: ["symbol", "price"], properties: { symbol: { type: "string" }, price: { type: "number" } } }, null, 2);
const STEPS = ["Service", "Response rules", "Test", "Bond"];

export default function MerchantSetup() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  const exists = Boolean(me.data);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", slug: "", endpointUrl: "", payoutAccountId: "", price: "0.10", timeoutMs: "10" });
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ passed: boolean; checks: Record<string, boolean>; detail: string | null } | null>(null);

  useEffect(() => {
    if (me.data) {
      const m = me.data;
      setF({ name: m.name, slug: m.slug, endpointUrl: m.endpointUrl, payoutAccountId: m.payoutAccountId, price: usdcInput(m.price), timeoutMs: String(m.timeoutMs / 1000) });
      setSchema(JSON.stringify(m.responseSchema, null, 2));
      if (m.status === "needs_bond" || m.status === "live") setStep(3);
    }
  }, [me.data]);

  const body = () => ({ name: f.name, slug: f.slug, endpointUrl: f.endpointUrl, payoutAccountId: f.payoutAccountId, price: microFromInput(f.price), timeoutMs: Math.round(Number(f.timeoutMs) * 1000), responseSchema: JSON.parse(schema) });
  const save = useMutation({
    mutationFn: () => exists ? patch<MerchantMe>(`/api/merchants/${me.data!.id}`, (({ slug: _s, ...rest }) => rest)(body())) : post<MerchantMe>("/api/merchants", body()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merchant-me"] }); setError(null); setStep((s) => Math.min(s + 1, 3)); },
    onError: (e) => setError(e instanceof ApiError ? `${e.code}${(e.body as { detail?: string })?.detail ? `: ${(e.body as { detail: string }).detail}` : ""}` : String(e)),
  });
  const runTest = useMutation({
    mutationFn: () => post<{ passed: boolean; checks: Record<string, boolean>; detail: string | null }>(`/api/merchants/${me.data!.id}/test`),
    onSuccess: (r) => { setTest(r); qc.invalidateQueries({ queryKey: ["merchant-me"] }); },
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const next = () => { setError(null); try { body(); } catch (e) { setError(String((e as Error).message)); return; } if (step <= 1) save.mutate(); else setStep(step + 1); };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Set up your service</h1>
      <ol className="flex gap-2 text-sm">{STEPS.map((s, i) => <li key={s} className={cx("rounded-full px-3 py-1", i === step ? "bg-blue-600 text-white" : i < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>{i + 1}. {s}</li>)}</ol>

      {step === 0 && (
        <div className="card space-y-4">
          <Field label="Name"><input className="input" value={f.name} onChange={set("name")} required /></Field>
          <Field label="Slug" hint="Lowercase letters, numbers and dashes. Agents call /v1/call/<slug>."><input className="input" value={f.slug} onChange={set("slug")} disabled={exists} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></Field>
          <Field label="Endpoint URL" hint="Your x402-protected POST endpoint. https in production."><input className="input" value={f.endpointUrl} onChange={set("endpointUrl")} placeholder="https://api.example.com/quote" /></Field>
          <Field label="Payout account" hint="Hedera account that receives USDC. Must be associated with USDC."><input className="input" value={f.payoutAccountId} onChange={set("payoutAccountId")} placeholder="0.0.12345" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Price (USDC)"><input className="input" value={f.price} onChange={set("price")} /></Field>
            <Field label="Timeout (seconds)" hint="1-30"><input className="input" type="number" min={1} max={30} value={f.timeoutMs} onChange={set("timeoutMs")} /></Field>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-3">
          <Field label="Response JSON Schema" hint='Must have type "object" and at least one "required" field, otherwise an empty-looking response would pass.'>
            <textarea className="input h-64 font-mono text-xs" value={schema} onChange={(e) => setSchema(e.target.value)} />
          </Field>
          <Alert tone="blue">A call fails if the status isn&apos;t 2xx, the body is empty, the response isn&apos;t JSON, it doesn&apos;t match this schema, or it takes longer than your timeout. A failed call refunds the agent from your bond.</Alert>
        </div>
      )}

      {step === 2 && me.data && (
        <div className="card space-y-3">
          <p className="text-sm text-slate-600">We call your endpoint without paying and expect a 402 with your payout account, USDC and price. This does not pay you, so it cannot check the paid response.</p>
          <button className="btn-primary" disabled={runTest.isPending} onClick={() => runTest.mutate()}>{runTest.isPending ? "Testing…" : "Test my endpoint"}</button>
          {test && (
            <ul className="space-y-1 text-sm">
              {Object.entries(test.checks).map(([k, v]) => <li key={k} className="flex items-center gap-2"><Badge tone={v ? "green" : "red"}>{v ? "pass" : "fail"}</Badge>{LABEL[k] ?? k}</li>)}
              {test.detail && <li className="text-xs text-rose-700">{test.detail}</li>}
            </ul>
          )}
        </div>
      )}

      {step === 3 && me.data && (
        <>
          <Alert tone="amber">Your bond is held in a custodial testnet vault in this version.</Alert>
          <Suspense><BondPanel merchantId={me.data.id} /></Suspense>
        </>
      )}

      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex justify-between">
        <button className="btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {step < 3 ? <button className="btn-primary" disabled={save.isPending || (step === 2 && !test?.passed)} onClick={next}>{step <= 1 ? "Save and continue" : "Continue"}</button> : <Link href="/merchant" className="btn-primary">Go to dashboard</Link>}
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { reachable: "Endpoint reachable", returns402: "Returns 402 Payment Required", payoutMatches: "Correct payout account", assetMatches: "Correct asset (USDC)", priceMatches: "Price at or below registered price" };
