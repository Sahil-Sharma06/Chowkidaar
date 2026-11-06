"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, EyeOff, ShieldCheck, UserCheck } from "lucide-react";
import { ApiError, get, loginUrl, post, type AuthConfig, type Me } from "@/lib/api";
import { Alert } from "@/lib/ui";
import { reasonText } from "@/lib/world";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

const PROMISES = [
  { icon: EyeOff, text: "No password and no email. We never see your name or documents." },
  { icon: UserCheck, text: "World ID only tells us you're a unique human, so nobody can run fake accounts." },
  { icon: ShieldCheck, text: "Before risky actions, like approving a large payment, we ask you to verify again." },
];

function Login() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const next = params.get("next") ?? "";
  const denied = params.get("world") === "denied";
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get<AuthConfig>("/api/auth/config") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: skip this page.
  useEffect(() => { if (me.data) router.replace(next || "/onboarding"); }, [me.data, next, router]);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const r = await post<{ next: string }>("/api/dev-login", { name: name.trim() || "demo" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push(next || r.next);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "validation_error" ? "Use only letters, numbers, spaces, dots and dashes in the display name." : "Couldn't sign you in. Check your connection and try again.");
      setPending(false);
    }
  }

  const c = cfg.data;
  const devForm = (primary: boolean) => (
    <form className="space-y-3" onSubmit={devLogin}>
      <label className="block">
        <span className="label">Display name</span>
        <input className="input" name="nickname" autoComplete="nickname" value={name} placeholder="demo" aria-invalid={error ? true : undefined}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }} />
      </label>
      {error && <Alert tone="red">{error}</Alert>}
      <button type="submit" className={primary ? "btn-primary h-12 w-full" : "btn-secondary h-11 w-full"} disabled={pending}>{pending ? "Signing in…" : "Continue with dev login"}</button>
    </form>
  );

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <section className="panel space-y-6 sm:p-8">
          <div className="space-y-4">
            <Logo className="h-11 w-11" />
            <div className="space-y-2">
              <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">Sign in to Chowkidaar</h1>
              <p className="text-sm leading-relaxed text-on-surface-variant">New here? Verifying creates your account. Next time, it signs you back in.</p>
            </div>
          </div>

          {denied && <Alert tone="red">{reasonText(params.get("reason"))} Nothing was changed. You can try again.</Alert>}

          {cfg.isLoading && <div className="skeleton h-12 rounded-full" />}

          {c?.agentPass && (
            <div className="space-y-5">
              <a className="btn-primary h-12 w-full text-[15px]" href={loginUrl(next)}><ShieldCheck aria-hidden className="h-4 w-4" /> Continue with World ID</a>
              <ul className="space-y-3">
                {PROMISES.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex gap-3 text-sm text-on-surface-variant">
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"><Icon className="h-3.5 w-3.5" /></span>
                    <span className="pt-1 leading-snug">{text}</span>
                  </li>
                ))}
              </ul>
              {c.environment === "staging" && <p className="text-xs text-outline">Test environment: World ID uses simulated identities here.</p>}
            </div>
          )}

          {c?.devLogin && (c.agentPass ? (
            <details className="group border-t border-rule pt-4">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg text-sm text-on-surface-variant transition-colors hover:text-on-surface [&::-webkit-details-marker]:hidden">
                Use the local dev login
                <ChevronDown aria-hidden className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="mt-4 space-y-3">
                <Alert tone="blue">Local development login is switched on (DEV_LOGIN). It is never available in production.</Alert>
                {devForm(false)}
              </div>
            </details>
          ) : (
            <div className="space-y-3">
              <Alert tone="blue">World ID is not configured on this server, so a local development login is used instead.</Alert>
              {devForm(true)}
            </div>
          ))}

          {c && !c.agentPass && !c.devLogin && <Alert tone="red">Sign-in isn&apos;t available on this server right now. Try again later.</Alert>}
        </section>
        <div className="mt-5 text-center">
          <Link href="/" className="inline-flex min-h-10 items-center rounded-full px-3 text-sm text-outline transition-colors hover:text-on-surface">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
