"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { MERCHANT_STATUS_TEXT, type PublicMerchant } from "@app/shared";
import { ApiError, get, patch, post, type MerchantMe } from "@/lib/api";
import { Alert, Badge, cx, microFromInput, usdcInput } from "@/lib/ui";
import { LoadError, PageHeader } from "@/components/owner/kit";

const EXAMPLE_SCHEMA = JSON.stringify({ type: "object", required: ["symbol", "price"], properties: { symbol: { type: "string" }, price: { type: "number" } } }, null, 2);
const STATUS_TONE: Record<string, string> = { live: "green", needs_bond: "amber", testing: "amber", draft: "amber", paused: "amber", suspended: "red" };
const STATUS_WORD: Record<string, string> = { live: "Live", needs_bond: "Needs bond", testing: "Needs test", draft: "Draft", paused: "Paused", suspended: "Suspended" };
const PANEL_TITLE = "font-display text-xl font-semibold tracking-[-0.01em]";
type TestResult = { passed: boolean; checks: Record<string, boolean>; detail: string | null };

const EMPTY = { name: "", slug: "", endpointUrl: "", payoutAccountId: "", price: "0.10", timeoutMs: "10", category: "", keywords: "", description: "", samplePrompt: "" };
type Form = typeof EMPTY;
type Key = keyof Form | "schema";

/** Field order for the error summary, with the id of the control each one links to. */
const FIELDS: [Key, string, string][] = [
  ["name", "name", "Name"], ["slug", "slug", "Slug"], ["endpointUrl", "endpoint", "Endpoint URL"], ["payoutAccountId", "payout", "Payout account"],
  ["price", "price", "Price per call"], ["timeoutMs", "timeout", "Timeout"], ["schema", "schema", "Response format"],
  ["category", "category", "Category"], ["keywords", "keywords", "Keywords"], ["description", "description", "Description"], ["samplePrompt", "sample", "Sample request"],
];
const ID = Object.fromEntries(FIELDS.map(([k, id]) => [k, id])) as Record<Key, string>;

/** Server field paths (from zod issues) to form fields. */
const PATH: Record<string, Key> = { name: "name", slug: "slug", endpointUrl: "endpointUrl", payoutAccountId: "payoutAccountId", price: "price", timeoutMs: "timeoutMs", responseSchema: "schema", category: "category", keywords: "keywords", description: "description", samplePrompt: "samplePrompt" };

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The same rules the gateway applies, checked here so the merchant hears about them on blur. */
function check(k: Key, f: Form, schema: string, exists: boolean): string | null {
  const v = k === "schema" ? schema : f[k].trim();
  switch (k) {
    case "name": return v.length < 2 || v.length > 60 ? "Enter a name of 2 to 60 characters." : null;
    case "slug":
      if (exists) return null;
      if (v.length < 2 || v.length > 40) return "Use 2 to 40 characters.";
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? null : "Use lowercase letters, numbers and single dashes, such as skycast-weather.";
    case "endpointUrl": {
      if (!v) return "Enter the URL agents' calls are sent to.";
      try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:" ? null : "Start the URL with https://."; }
      catch { return "Enter a full URL, such as https://api.example.com/quote."; }
    }
    case "payoutAccountId": return /^0\.0\.\d+$/.test(v) ? null : "Enter a Hedera account id, such as 0.0.12345.";
    case "price": {
      try { return microFromInput(v) > 0 ? null : "Enter a price above zero."; }
      catch { return "Enter a USDC amount with up to 6 decimals, such as 0.10."; }
    }
    case "timeoutMs": { const n = Number(v); return v && Number.isFinite(n) && n >= 1 && n <= 30 ? null : "Enter a timeout between 1 and 30 seconds."; }
    case "schema": {
      let parsed: unknown;
      try { parsed = JSON.parse(v); } catch (e) { return `The response schema isn't valid JSON: ${clip((e as Error).message)}`; }
      const o = parsed as { type?: unknown; required?: unknown } | null;
      return o && typeof o === "object" && o.type === "object" && Array.isArray(o.required) && o.required.length > 0
        ? null : 'Set "type": "object" and list at least one field under "required".';
    }
    case "category": return !v || /^[a-z][a-z0-9-]{1,23}$/.test(v.toLowerCase()) ? null : "Use one short lowercase word, such as food.";
    case "keywords": {
      const ks = v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      if (ks.length > 24) return "Use at most 24 keywords.";
      return ks.some((s) => s.length < 2 || s.length > 24) ? "Each keyword needs 2 to 24 characters." : null;
    }
    default: return null;
  }
}

/** Gateway error codes as sentences, attached to the field they're about when there is one. */
function fromServer(e: unknown): { field?: Key; text: string }[] {
  if (!(e instanceof ApiError)) return [{ text: "Couldn't save your service. Check your connection and try again." }];
  const body = e.body as { detail?: string; issues?: string[] } | null;
  switch (e.code) {
    case "invalid_input": {
      if (!body?.issues?.length) return [{ text: "Some fields aren't valid. Check them and try again." }];
      return body.issues.map((i): { field?: Key; text: string } => {
        const [path, ...rest] = i.split(": ");
        return { field: PATH[path.split(".")[0]], text: rest.join(": ") || i };
      });
    }
    case "bad_schema": return [{ field: "schema", text: `The gateway can't use this schema: ${clip(body?.detail ?? "it isn't a valid JSON Schema.")}` }];
    case "endpoint_must_be_https": return [{ field: "endpointUrl", text: "Use an https URL. Plain http only works on the demo gateway." }];
    case "endpoint_not_public": return [{ field: "endpointUrl", text: "This URL points to a private address. Use one that's reachable from the internet." }];
    case "slug_taken": return [{ field: "slug", text: "That slug is taken. Choose another one." }];
    case "already_registered": return [{ text: "This account already has a service. Reload the page to edit it." }];
    case "suspended": return [{ text: "This service is suspended, so its settings can't be changed." }];
    default: return [{ text: "Couldn't save your service. Check your connection and try again." }];
  }
}

export default function MerchantSetup() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  const exists = Boolean(me.data);
  const [f, setF] = useState<Form>(EMPTY);
  // Categories already in use, so merchants converge on the same words without a fixed list.
  const catalog = useQuery({ queryKey: ["public-merchants"], queryFn: () => get<PublicMerchant[]>("/api/public/merchants"), staleTime: 60_000 });
  const knownCategories = [...new Set((catalog.data ?? []).map((m) => m.category))];
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [initial, setInitial] = useState<string>(() => JSON.stringify([EMPTY, EXAMPLE_SCHEMA]));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me.data) {
      const m = me.data;
      const next = { name: m.name, slug: m.slug, endpointUrl: m.endpointUrl, payoutAccountId: m.payoutAccountId, price: usdcInput(m.price), timeoutMs: String(m.timeoutMs / 1000), category: m.category, keywords: m.keywords.join(", "), description: m.description ?? "", samplePrompt: m.samplePrompt ?? "" };
      const nextSchema = JSON.stringify(m.responseSchema, null, 2);
      setF(next);
      setSchema(nextSchema);
      setInitial(JSON.stringify([next, nextSchema]));
    }
  }, [me.data]);

  const body = () => ({
    name: f.name.trim(), slug: f.slug.trim(), endpointUrl: f.endpointUrl.trim(), payoutAccountId: f.payoutAccountId.trim(), price: microFromInput(f.price), timeoutMs: Math.round(Number(f.timeoutMs) * 1000), responseSchema: JSON.parse(schema),
    category: f.category.trim().toLowerCase() || "other", keywords: f.keywords.split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean),
    description: f.description.trim() || undefined, samplePrompt: f.samplePrompt.trim() || undefined,
  });

  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus());
  const save = useMutation({
    mutationFn: () => exists ? patch<MerchantMe>(`/api/merchants/${me.data!.id}`, (({ slug: _s, ...rest }) => rest)(body())) : post<MerchantMe>("/api/merchants", body()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merchant-me"] }); setErrors({}); setGeneral(null); setShowSummary(false); setSaved(true); setTest(null); },
    onError: (e) => {
      const found = fromServer(e);
      const fieldErrors: Partial<Record<Key, string>> = {};
      const loose: string[] = [];
      for (const x of found) { if (x.field && !fieldErrors[x.field]) fieldErrors[x.field] = x.text; else if (!x.field) loose.push(x.text); }
      setErrors(fieldErrors); setGeneral(loose.join(" ") || null); setShowSummary(true); focusSummary();
    },
  });
  const runTest = useMutation({
    mutationFn: () => post<TestResult>(`/api/merchants/${me.data!.id}/test`),
    onSuccess: (r) => { setTest(r); qc.invalidateQueries({ queryKey: ["merchant-me"] }); },
  });

  const validate = (k: Key, nextF = f, nextSchema = schema) => setErrors((prev) => {
    const msg = check(k, nextF, nextSchema, exists);
    if ((prev[k] ?? null) === msg) return prev;
    const next = { ...prev };
    if (msg) next[k] = msg; else delete next[k];
    return next;
  });
  /** Typing in a field that shows an error re-checks it, so the message goes away as soon as it's fixed. */
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...f, [k]: e.target.value };
    setSaved(false); setF(next);
    if (errors[k]) validate(k, next);
  };
  const blur = (k: Key) => () => { if ((k === "schema" ? schema : f[k]).trim() !== "" || errors[k]) validate(k); };

  const submit = () => {
    setSaved(false); setGeneral(null);
    const all: Partial<Record<Key, string>> = {};
    for (const [k] of FIELDS) { const msg = check(k, f, schema, exists); if (msg) all[k] = msg; }
    setErrors(all);
    if (Object.keys(all).length) { setShowSummary(true); focusSummary(); return; }
    setShowSummary(false);
    save.mutate();
  };

  const edited = JSON.stringify([f, schema]) !== initial;
  const dirty = !exists || edited;
  const schemaOk = (() => { try { JSON.parse(schema); return true; } catch { return false; } })();
  const status = me.data?.status;
  const published = status === "live" || status === "paused";
  const needsTest = status === "draft" || status === "testing";

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!edited || save.isPending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edited, save.isPending]);

  if (me.isLoading) return <div className="space-y-5"><div className="skeleton h-10 w-64" /><div className="skeleton h-96" /></div>;
  if (me.isError && !(me.error instanceof ApiError && me.error.status === 404)) return <LoadError what="your service" retry={() => me.refetch()} />;

  const listed = FIELDS.filter(([k]) => errors[k]);
  const a11y = (k: Key, hint = true) => {
    const id = ID[k];
    return { id, "aria-invalid": errors[k] ? true : undefined, "aria-describedby": cx(hint && `${id}-hint`, errors[k] && `${id}-error`) || undefined, onBlur: blur(k) };
  };

  return (
    <div>
      <PageHeader
        title={exists ? <span className="flex flex-wrap items-center gap-3">Service settings{status && <Badge tone={STATUS_TONE[status]}>{STATUS_WORD[status] ?? status}</Badge>}</span> : "Set up your service"}
        sub={exists && status ? MERCHANT_STATUS_TEXT[status] : "Tell agents what you sell, what it costs and what a good response looks like."}
        actions={exists ? <Link href="/merchant" className="btn-ghost">Dashboard</Link> : undefined}
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
        <form className="space-y-4 sm:space-y-5 lg:col-span-8" noValidate onSubmit={(e) => { e.preventDefault(); if (!save.isPending && dirty) submit(); }}>
          {showSummary && (listed.length > 0 || general) && (
            <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="error-summary-title" className="rounded-[24px] bg-bad-subtle p-5 text-sm text-bad sm:p-6">
              <h2 id="error-summary-title" className="text-[15px] font-semibold">
                {listed.length ? `${listed.length === 1 ? "One field needs" : `${listed.length} fields need`} fixing before you can save` : "Your service wasn't saved"}
              </h2>
              {general && <p className="mt-1.5">{general}</p>}
              {listed.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {listed.map(([k, id, label]) => (
                    <li key={k}>
                      <a href={`#${id}`} className="underline underline-offset-4" onClick={(e) => { e.preventDefault(); const el = document.getElementById(id); el?.focus(); el?.scrollIntoView({ block: "center" }); }}>
                        {label}: {errors[k]}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Group title="Service" sub="What agents call and where the money goes.">
            <Row id="name" label="Name" hint="Shown to agent owners in the catalog." error={errors.name}>
              <input {...a11y("name")} className="input" value={f.name} onChange={set("name")} required maxLength={60} placeholder="SkyCast weather" />
            </Row>
            <Row id="slug" label="Slug" hint={exists ? "Fixed once registered." : "Lowercase letters, numbers and dashes."} error={errors.slug}>
              <input {...a11y("slug")} className="input font-mono text-[13px]" value={f.slug} onChange={set("slug")} disabled={exists} autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={40} placeholder="skycast" />
              <p className="mt-1.5 text-xs text-outline">Agents call <span className="break-all font-mono">/v1/call/{f.slug || "<slug>"}</span></p>
            </Row>
            <Row id="endpoint" label="Endpoint URL" hint="Your x402-protected POST endpoint. Use https in production." error={errors.endpointUrl}>
              <input {...a11y("endpointUrl")} type="url" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} className="input font-mono text-[13px]" value={f.endpointUrl} onChange={set("endpointUrl")} placeholder="https://api.example.com/quote" />
            </Row>
            <Row id="payout" label="Payout account" hint="Hedera account that receives USDC. It must already be associated with USDC." error={errors.payoutAccountId}>
              <input {...a11y("payoutAccountId")} inputMode="decimal" autoComplete="off" spellCheck={false} className="input font-mono text-[13px]" value={f.payoutAccountId} onChange={set("payoutAccountId")} placeholder="0.0.12345" />
            </Row>
          </Group>

          <Group title="Pricing and limits" sub="Your bond minimum grows with your price.">
            <Row id="price" label="Price per call" hint="In USDC, up to 6 decimals." error={errors.price}>
              <div className="relative">
                <input {...a11y("price")} className="input money pr-16" inputMode="decimal" value={f.price} onChange={set("price")} />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-outline">USDC</span>
              </div>
            </Row>
            <Row id="timeout" label="Timeout" hint="Between 1 and 30 seconds. Slower responses count as failed and are refunded." error={errors.timeoutMs}>
              <div className="relative">
                <input {...a11y("timeoutMs")} className="input money pr-20" type="number" inputMode="decimal" min={1} max={30} value={f.timeoutMs} onChange={set("timeoutMs")} />
                <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-sm text-outline">sec</span>
              </div>
            </Row>
          </Group>

          <Group title="Response format" sub="The JSON Schema every paid response must match." aside={<Badge tone={schemaOk ? "green" : "red"}>{schemaOk ? "Valid JSON" : "Invalid JSON"}</Badge>}>
            <div className="py-4">
              <label htmlFor="schema" className="sr-only">Response JSON Schema</label>
              <textarea {...a11y("schema")} spellCheck={false} className="input h-72 resize-y font-mono text-xs leading-relaxed" value={schema}
                onChange={(e) => { setSaved(false); setSchema(e.target.value); if (errors.schema) validate("schema", f, e.target.value); }} />
              {errors.schema && <p id="schema-error" className="mt-1.5 text-xs text-bad">{errors.schema}</p>}
              <p id="schema-hint" className="mt-2 text-xs text-outline">Use <span className="font-mono">&quot;type&quot;: &quot;object&quot;</span> and list at least one field under <span className="font-mono">&quot;required&quot;</span>, otherwise an empty-looking response would pass.</p>
              <details className="well mt-3 px-4 py-3 text-sm">
                <summary className="cursor-pointer text-on-surface-variant hover:text-on-surface">What counts as a failed call</summary>
                <p className="mt-2 leading-relaxed text-on-surface-variant">A call fails if the status isn&apos;t 2xx, the body is empty, the response isn&apos;t JSON, it doesn&apos;t match this schema, or it takes longer than your timeout. A failed call refunds the agent from your bond.</p>
              </details>
            </div>
          </Group>

          <Group title="Listing" sub="How agents find you when someone asks for something.">
            <Row id="category" label="Category" hint={knownCategories.length ? `In use: ${knownCategories.join(", ")}` : "One lowercase word, such as food."} error={errors.category}>
              <input {...a11y("category")} className="input" list="categories" autoCapitalize="none" value={f.category} onChange={set("category")} placeholder="food" />
              <datalist id="categories">{knownCategories.map((c) => <option key={c} value={c} />)}</datalist>
            </Row>
            <Row id="keywords" label="Keywords" hint="Comma-separated words agents might ask for. This is how an agent finds you." error={errors.keywords}>
              <input {...a11y("keywords")} className="input" value={f.keywords} onChange={set("keywords")} placeholder="burger, fries, lunch" />
            </Row>
            <Row id="description" label="Description" hint="One line, shown in the catalog." error={errors.description}>
              <input {...a11y("description")} className="input" maxLength={160} value={f.description} onChange={set("description")} placeholder="Confirms a burger order in under a minute" />
            </Row>
            <Row id="sample" label="Sample request" hint="Something a person would ask their agent. Shown as a suggestion in the console." error={errors.samplePrompt}>
              <input {...a11y("samplePrompt")} className="input" maxLength={120} value={f.samplePrompt} onChange={set("samplePrompt")} placeholder="Get me a burger" />
            </Row>
          </Group>

          <div className="panel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm text-on-surface-variant">
              {saved ? (exists && !published ? "Saved. Test your endpoint next." : "Saved.")
                : exists && published ? "Saving changes takes you offline until your endpoint passes the test again."
                : exists ? "Changes need a fresh endpoint test." : "You can test your endpoint once it's saved."}
            </p>
            <button type="submit" className={cx("shrink-0", dirty ? "btn-primary" : "btn-secondary")} disabled={save.isPending || !dirty}>
              {exists ? "Save changes" : "Register service"}{save.isPending && "…"}
            </button>
          </div>
        </form>

        <aside className="lg:col-span-4">
          <div className="panel space-y-5 lg:sticky lg:top-6">
            <h2 className={PANEL_TITLE}>Go live</h2>
            {status === "suspended" && <Alert tone="red">This service is suspended. Agents can&apos;t pay it.</Alert>}
            <ol className="space-y-5">
              <Step n={1} title="Register your service" state={exists ? "done" : "current"}>
                {!exists && <p>Fill in the form and register. You can change everything except the slug later.</p>}
              </Step>
              <Step n={2} title="Test your endpoint" state={!exists ? "todo" : needsTest ? "current" : "done"}>
                {exists && (
                  <div className="space-y-3">
                    <p>We call your endpoint without paying and expect a 402 with your payout account, USDC and price. This doesn&apos;t pay you, so it can&apos;t check the paid response.</p>
                    <button type="button" className={needsTest && !edited ? "btn-primary" : "btn-secondary"} disabled={runTest.isPending} onClick={() => runTest.mutate()}>
                      {test ? "Test again" : "Test my endpoint"}{runTest.isPending && "…"}
                    </button>
                    {runTest.isError && <Alert tone="red">The test couldn&apos;t run. Check your connection and try again.</Alert>}
                    {test && (
                      <ul className="space-y-1.5" aria-live="polite">
                        {Object.entries(test.checks).map(([k, v]) => (
                          <li key={k} className="flex items-center justify-between gap-3 text-on-surface"><span>{LABEL[k] ?? k}</span><Badge tone={v ? "green" : "red"}>{v ? "Pass" : "Fail"}</Badge></li>
                        ))}
                        {test.detail && <li className="break-all font-mono text-xs text-bad">{test.detail}</li>}
                      </ul>
                    )}
                  </div>
                )}
              </Step>
              <Step n={3} title="Post a bond" state={status === "live" ? "done" : status === "needs_bond" || status === "paused" ? "current" : "todo"}>
                {(status === "needs_bond" || status === "paused") && (
                  <div className="space-y-3">
                    <p>Deposit USDC that refunds agents when a call fails. Once it covers the minimum, agents can pay you.</p>
                    <Link href="/merchant/bond" className={edited ? "btn-secondary" : "btn-primary"}>Post bond</Link>
                  </div>
                )}
                {status === "live" && <p>You&apos;re live. <Link href="/merchant" className="text-on-surface underline decoration-outline underline-offset-4 hover:decoration-on-surface">Go to your dashboard</Link>.</p>}
              </Step>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

const LABEL: Record<string, string> = { reachable: "Endpoint reachable", returns402: "Returns 402 Payment Required", payoutMatches: "Correct payout account", assetMatches: "Correct asset (USDC)", priceMatches: "Price at or below registered price" };

function Group({ title, sub, aside, children }: { title: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="flex items-start justify-between gap-4 pb-2">
        <div>
          <h2 className={PANEL_TITLE}>{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-on-surface-variant">{sub}</p>}
        </div>
        {aside}
      </div>
      <div className="divide-y divide-rule">{children}</div>
    </section>
  );
}

/** Settings row: what it is and why on the left, the control and its error on the right. Stacks on small screens. */
function Row({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-6">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-on-surface">{label}</label>
        {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs leading-relaxed text-outline">{hint}</p>}
      </div>
      <div className="min-w-0">
        {children}
        {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-bad">{error}</p>}
      </div>
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "current" | "todo"; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        state === "done" ? "bg-surface-container-high text-on-surface" : state === "current" ? "bg-on-surface text-surface" : "bg-surface-container text-outline")}>
        {state === "done" ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={cx("text-sm font-medium", state === "todo" ? "text-outline" : "text-on-surface")}>{title}</div>
        {children && <div className="mt-2 text-sm leading-relaxed text-on-surface-variant">{children}</div>}
      </div>
    </li>
  );
}
