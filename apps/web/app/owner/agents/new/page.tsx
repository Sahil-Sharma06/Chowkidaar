"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, KeyRound, Wallet } from "lucide-react";
import { ApiError, GATEWAY_URL, HASHSCAN, post, type AgentRow } from "@/lib/api";
import { Alert, CopyButton, cx, microFromInput } from "@/lib/ui";
import { PageHeader } from "@/components/owner/kit";
import { McpSnippet } from "@/components/McpSnippet";

const WALLETS = [
  ["custodial", "Create one for me", "A new Hedera testnet account. The gateway keeps its key so you can pay from the playground."],
  ["own", "Use my own account", "Your agent pays with its own key from your code. The gateway never sees it."],
] as const;

type Form = { name: string; hederaAccountId: string; perCallCap: string; dailyCap: string; approvalThreshold: string; minScore: string };
type Key = keyof Form;
type Errors = Partial<Record<Key, string>>;

const LABEL: Record<Key, string> = {
  name: "Name", hederaAccountId: "Hedera account", perCallCap: "Per payment", dailyCap: "Per day", approvalThreshold: "Ask me above", minScore: "Minimum merchant score",
};
const ORDER: Key[] = ["name", "hederaAccountId", "perCallCap", "dailyCap", "approvalThreshold", "minScore"];
const AMOUNT = /^\d+(?:\.\d{1,6})?$/;
const micro = (s: string) => (AMOUNT.test(s.trim()) ? microFromInput(s) : null);

/** Same rules the gateway applies (createAgentSchema), checked before the request so mistakes show next to the field. */
function validate(f: Form, wallet: "custodial" | "own"): Errors {
  const e: Errors = {};
  const n = f.name.trim().length;
  if (n < 2 || n > 40) e.name = "Enter a name between 2 and 40 characters.";
  if (wallet === "own" && !/^0\.0\.\d+$/.test(f.hederaAccountId.trim())) e.hederaAccountId = "Enter a Hedera account ID like 0.0.12345.";
  const per = micro(f.perCallCap), day = micro(f.dailyCap), ask = micro(f.approvalThreshold);
  if (per === null || per <= 0) e.perCallCap = "Enter an amount above 0 USDC, with up to 6 decimals.";
  if (day === null || day <= 0) e.dailyCap = "Enter an amount above 0 USDC, with up to 6 decimals.";
  else if (per !== null && per > 0 && day < per) e.dailyCap = "Set the daily limit at or above the per-payment limit.";
  if (ask === null) e.approvalThreshold = "Enter an amount in USDC, with up to 6 decimals.";
  else if (per !== null && per > 0 && ask > per) e.approvalThreshold = "Set this at or below the per-payment limit.";
  const score = f.minScore.trim();
  if (!/^\d+$/.test(score) || Number(score) > 100) e.minScore = "Enter a whole number from 0 to 100.";
  return e;
}

function serverMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "validation_error": return "Check the limits: amounts must be positive and the daily limit at least the per-payment limit.";
      case "approval_above_per_call": return "Set “Ask me above” at or below the per-payment limit.";
      case "hedera_account_in_use": return "That Hedera account is already registered to an agent. Use a different account, or let us create one for you.";
      case "wallet_create_failed": return "Couldn't create the wallet on Hedera. Try again in a moment.";
      case "network": return "Couldn't reach Hedera. Try again in a moment.";
    }
  }
  return "Couldn't create the agent. Check your connection and try again.";
}

export default function NewAgentPage() {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>({ name: "", hederaAccountId: "", perCallCap: "0.50", dailyCap: "5", approvalThreshold: "0.25", minScore: "60" });
  const [wallet, setWallet] = useState<"custodial" | "own">("custodial");
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [accountInUse, setAccountInUse] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [created, setCreated] = useState<AgentRow | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const all = validate(f, wallet);
  const shown: Errors = {};
  for (const k of ORDER) if ((touched[k] || submitted) && all[k]) shown[k] = all[k];
  if (accountInUse && wallet === "own" && !shown.hederaAccountId) shown.hederaAccountId = "Already registered to another agent.";
  const invalid = ORDER.filter((k) => shown[k]);

  useEffect(() => { if (focusTick) summaryRef.current?.focus(); }, [focusTick]);

  const m = useMutation({
    mutationFn: () => post<AgentRow>("/api/agents", {
      name: f.name.trim(), ...(wallet === "own" ? { hederaAccountId: f.hederaAccountId.trim() } : {}),
      perCallCap: microFromInput(f.perCallCap), dailyCap: microFromInput(f.dailyCap),
      approvalThreshold: microFromInput(f.approvalThreshold), minScore: Number(f.minScore),
    }),
    onSuccess: (a) => { setCreated(a); qc.invalidateQueries({ queryKey: ["agents"] }); },
    onError: (e) => {
      setServerError(serverMessage(e));
      if (e instanceof ApiError && e.code === "hedera_account_in_use") setAccountInUse(true);
      setFocusTick((t) => t + 1);
    },
  });

  if (created) {
    const snippet = `const res = await payFetch("${GATEWAY_URL}/v1/call/MERCHANT_SLUG", {\n  method: "POST",\n  headers: { "content-type": "application/json", "x-agent-key": "${created.apiKey}" },\n  body: JSON.stringify({ /* your request */ }),\n});`;
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={`${created.name} is ready`} sub="Save its API key, then connect it to your code or assistant." />
        <section className="panel space-y-6">
          {created.custodial && (
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"><Wallet className="h-4 w-4" /></span>
              <div className="min-w-0 text-sm">
                <div className="font-medium">Wallet created on Hedera</div>
                <a className="inline-flex items-center gap-1 font-mono text-on-surface-variant underline decoration-outline underline-offset-4 transition-colors hover:text-primary hover:decoration-primary" href={`${HASHSCAN}/account/${created.hederaAccountId}`} target="_blank" rel="noreferrer">
                  {created.hederaAccountId} <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                </a>
                <p className="mt-1 text-on-surface-variant">Fund it with testnet USDC and pay from the playground.</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium"><KeyRound aria-hidden className="h-4 w-4 text-on-surface-variant" /> API key</div>
            {/* 36px round button, 8px inset: the well's radius is 18 + 8 so the corners stay concentric. */}
            <div className="flex items-center gap-3 rounded-[26px] bg-surface-container-low py-2 pl-4 pr-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-on-surface">{created.apiKey}</code>
              <CopyButton text={created.apiKey ?? ""} label="Copy API key" />
            </div>
            <Alert tone="amber">Copy the key now. <strong>It&apos;s shown once</strong> and you won&apos;t see it again.{created.custodial && " The playground keeps its own copy for this agent."}</Alert>
          </div>

          <div className="divide-y divide-rule border-y border-rule">
            {created.custodial && (
              <Disclosure title="Use from Claude, ChatGPT or Cursor"><McpSnippet apiKey={created.apiKey} /></Disclosure>
            )}
            <Disclosure title="Call from your code">
              <div className="well relative">
                <div className="absolute right-2 top-2"><CopyButton text={snippet} label="Copy code" /></div>
                <pre className="overflow-x-auto p-4 pr-12 font-mono text-xs leading-relaxed text-on-surface">{snippet}</pre>
              </div>
            </Disclosure>
          </div>

          <p className="text-sm text-on-surface-variant">Next, allow merchants on the agent page so it can pay them.</p>
          <div className="flex flex-wrap gap-3">
            <Link className="btn-primary h-11 px-5" href={`/owner/agents/${created.id}`}>Open agent</Link>
            {created.custodial && <Link className="btn-secondary h-11 px-5" href="/playground">Go to playground</Link>}
          </div>
        </section>
      </div>
    );
  }

  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: e.target.value });
    if (k === "hederaAccountId") setAccountInUse(false);
  };
  const blur = (k: Key) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  // Every input gets the same error wiring: aria-invalid plus a description that reads the hint and the error.
  const aria = (k: Key, hint = true) => ({
    id: `f-${k}`, "aria-invalid": shown[k] ? true : undefined,
    "aria-describedby": [hint && `f-${k}-hint`, shown[k] && `f-${k}-error`].filter(Boolean).join(" ") || undefined,
    onChange: set(k), onBlur: blur(k), value: f[k],
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    setSubmitted(true);
    setServerError(null);
    const errs = validate(f, wallet);
    if (Object.keys(errs).length) { setFocusTick((t) => t + 1); return; }
    m.mutate();
  };

  return (
    <form className="mx-auto max-w-2xl" noValidate onSubmit={submit}>
      <PageHeader title="New agent" sub="Give it a wallet and the limits it must stay inside. You can change these later." />
      <section className="panel space-y-8">
        {(serverError || invalid.length > 0) && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-2xl bg-bad-subtle px-4 py-3 text-sm leading-relaxed text-bad">
            {serverError ?? (
              <>
                <p className="font-medium">Fix {invalid.length === 1 ? "this field" : `these ${invalid.length} fields`} to create the agent:</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  {invalid.map((k) => <li key={k}><a className="underline underline-offset-4" href={`#f-${k}`} onClick={(e) => { e.preventDefault(); document.getElementById(`f-${k}`)?.focus(); }}>{LABEL[k]}</a>: {shown[k]}</li>)}
                </ul>
              </>
            )}
          </div>
        )}

        <Step n={1} title="Name it">
          <label htmlFor="f-name" className="label">Name <span className="text-outline">(required)</span></label>
          <input className="input" required minLength={2} maxLength={40} autoComplete="off" {...aria("name")} />
          <Hint id="f-name-hint">Something you&apos;ll recognise, like Research bot.</Hint>
          <FieldError k="name" msg={shown.name} />
        </Step>

        <Step n={2} title="Choose a wallet">
          <fieldset>
            <legend className="sr-only">Wallet</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {WALLETS.map(([k, t, d]) => {
                const on = wallet === k;
                return (
                  <label key={k}
                    className={cx("well block cursor-pointer p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                      on ? "ring-2 ring-primary" : "hover:bg-surface-container")}>
                    <input type="radio" name="wallet" value={k} checked={on} onChange={() => setWallet(k)} className="sr-only" aria-describedby={`wallet-${k}-desc`} />
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium">{t}</span>
                      <span aria-hidden className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-on-primary" : "border-field")}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                    </span>
                    <span id={`wallet-${k}-desc`} className="mt-1.5 block text-xs leading-relaxed text-on-surface-variant">{d}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {wallet === "own" && (
            <div className="mt-4">
              <label htmlFor="f-hederaAccountId" className="label">Hedera account</label>
              <input className="input font-mono" required pattern="0\.0\.\d+" title="A Hedera account ID, like 0.0.12345" placeholder="0.0.12345"
                autoComplete="off" spellCheck={false} {...aria("hederaAccountId")} />
              <Hint id="f-hederaAccountId-hint">The account your agent pays from, like 0.0.12345. It must hold testnet USDC.</Hint>
              <FieldError k="hederaAccountId" msg={shown.hederaAccountId} />
            </div>
          )}
        </Step>

        <Step n={3} title="Set its limits">
          <div className="divide-y divide-rule">
            <Row id="perCallCap" label="Per payment" hint="The most a single payment can cost." error={shown.perCallCap}>
              <Amount {...aria("perCallCap")} />
            </Row>
            <Row id="dailyCap" label="Per day" hint="The most the agent can spend in a day. At least the per-payment limit." error={shown.dailyCap}>
              <Amount {...aria("dailyCap")} />
            </Row>
            <Row id="approvalThreshold" label="Ask me above" hint="Bigger payments wait for your approval. At most the per-payment limit." error={shown.approvalThreshold}>
              <Amount {...aria("approvalThreshold")} />
            </Row>
            <Row id="minScore" label="Minimum merchant score" hint="0 to 100. Merchants with fewer than 5 calls count as new and are allowed." error={shown.minScore}>
              <input className="input money text-right" type="number" inputMode="numeric" min={0} max={100} step={1} {...aria("minScore")} />
            </Row>
          </div>
        </Step>

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-6">
          <button type="submit" className="btn-primary h-11 px-5" disabled={m.isPending}>{m.isPending ? (wallet === "custodial" ? "Creating wallet on Hedera…" : "Creating agent…") : "Create agent"}</button>
          <Link href="/owner" className="btn-ghost h-11 px-5">Cancel</Link>
        </div>
      </section>
    </form>
  );
}

function Hint({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="mt-1.5 text-xs leading-relaxed text-outline">{children}</p>;
}

function FieldError({ k, msg }: { k: Key; msg?: string }) {
  if (!msg) return null;
  return <p id={`f-${k}-error`} className="mt-1.5 text-xs leading-relaxed text-bad">{msg}</p>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden className="money flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container text-xs font-medium text-on-surface-variant">{n}</span>
        <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Row({ id, label, hint, error, children }: { id: Key; label: string; hint: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <label htmlFor={`f-${id}`} className="text-sm font-medium">{label}</label>
          <p id={`f-${id}-hint`} className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{hint}</p>
        </div>
        <div className="sm:w-44 sm:shrink-0">{children}</div>
      </div>
      <FieldError k={id} msg={error} />
    </div>
  );
}

function Amount(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input className="input money pr-16 text-right" inputMode="decimal" autoComplete="off" {...props} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-outline">USDC</span>
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium transition-colors hover:text-on-surface-variant [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden className="h-4 w-4 text-on-surface-variant transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}
