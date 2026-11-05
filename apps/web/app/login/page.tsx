"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError, get, loginUrl, post, type AuthConfig, type Me } from "@/lib/api";
import { Alert } from "@/lib/ui";
import { reasonText } from "@/lib/world";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

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

  // Already signed in: skip this page.
  useEffect(() => { if (me.data) router.replace(next || "/onboarding"); }, [me.data, next, router]);

  async function devLogin() {
    setError(null);
    try {
      const r = await post<{ next: string }>("/api/dev-login", { name: name.trim() || "demo" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push(next || r.next);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "validation_error" ? "Use letters, numbers, spaces, dots, dashes." : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-8">
      <div className="space-y-2 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-blue-600" />
        <h1 className="text-2xl font-semibold">Sign in or create your account</h1>
        <p className="text-sm text-slate-600">
          One World ID, one account. New here? Verifying creates your account; next time it signs you back in.
        </p>
      </div>

      {denied && <Alert tone="red">{reasonText(params.get("reason"))} Nothing was changed. You can try again.</Alert>}

      <div className="card space-y-4">
        {cfg.isLoading ? <div className="text-sm text-slate-500">Loading…</div>
          : cfg.data?.agentPass ? (
            <>
              <a className="btn-primary w-full" href={loginUrl(next)}><ShieldCheck className="h-4 w-4" /> Continue with World ID</a>
              <ul className="space-y-1 text-xs text-slate-600">
                <li>• No password and no email. We never see your name or documents.</li>
                <li>• World ID only tells us you are a unique human, so nobody can run many fake accounts.</li>
                <li>• Before risky actions, like approving a large payment, we ask you to verify again.</li>
              </ul>
              {cfg.data.environment === "staging" && <p className="text-xs text-slate-500">Test environment: World ID uses simulated identities here.</p>}
            </>
          ) : cfg.data?.devLogin ? (
            <>
              <Alert tone="blue">World ID is not configured on this server, so a local development login is used instead.</Alert>
              <label className="block"><span className="label">Display name</span>
                <input className="input" value={name} placeholder="demo" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && devLogin()} />
              </label>
              <button className="btn-primary w-full" onClick={devLogin}>Continue</button>
            </>
          ) : <Alert tone="red">Sign-in is not available right now. Please try again later.</Alert>}
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </div>
  );
}
