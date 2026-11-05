"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Store } from "lucide-react";
import { get, post } from "@/lib/api";
import { Alert, cx } from "@/lib/ui";
import { WorldLogin } from "@/components/WorldLogin";

type Role = "owner" | "merchant";

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}

function Login() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>((params.get("role") as Role) ?? "owner");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("demo");
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get<{ world: boolean; environment: string; devLogin: boolean; agentPass: boolean }>("/api/auth/config") });
  const denied = params.get("world") === "denied";

  const done = async () => { await qc.invalidateQueries({ queryKey: ["me"] }); router.push(role === "owner" ? "/owner" : "/merchant"); };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Who are you?</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {([["owner", "I run an agent", "Set limits, watch spending, approve large payments.", Bot], ["merchant", "I sell a service", "Register your endpoint, post a bond, build reputation.", Store]] as const).map(([r, t, d, Icon]) => (
          <button key={r} onClick={() => { setRole(r); setError(null); }} className={cx("card text-left transition", role === r ? "ring-2 ring-blue-500" : "hover:bg-slate-50")}>
            <Icon className="mb-2 h-6 w-6 text-blue-600" /><div className="font-medium">{t}</div><div className="text-sm text-slate-600">{d}</div>
          </button>
        ))}
      </div>

      {role === "owner" && cfg.data?.agentPass && (
        <div className="card space-y-2">
          <a className="btn-primary w-full" href="/api/world/oidc/start?purpose=login">Sign in with World ID Agent Pass</a>
          <p className="text-xs text-slate-500">OpenID Connect through auth.world.org. The same World ID is asked again, fresh, before you approve a large agent payment.</p>
          {denied && <Alert tone="red">World ID sign-in did not complete ({params.get("reason")}).</Alert>}
        </div>
      )}
      <div className="card space-y-3">
        {cfg.data?.world ? (
          <>
            <WorldLogin role={role} onDone={done} onError={setError} />
            {cfg.data.environment === "staging" && <p className="text-xs text-slate-500">Demo mode: verify using the <a className="text-blue-700 hover:underline" href="https://simulator.worldcoin.org" target="_blank" rel="noreferrer">World ID simulator</a>. Proofs use fake identities in this event.</p>}
          </>
        ) : cfg.data?.devLogin ? (
          <>
            <Alert tone="blue">World ID is not configured on this server. Development login is enabled instead.</Alert>
            <label className="block"><span className="label">Display name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn-primary w-full" onClick={async () => { try { await post("/api/dev-login", { role, name }); await done(); } catch { setError("Something went wrong. Please try again."); } }}>Continue as {role}</button>
          </>
        ) : cfg.isLoading ? <div className="text-sm text-slate-500">Loading…</div> : <Alert tone="red">Login is unavailable.</Alert>}
        {error && <Alert tone="red">{error}</Alert>}
        <p className="text-xs text-slate-500">One human, one merchant: the same World ID can never register a second merchant, so a slashed merchant can&apos;t return under a new name.</p>
      </div>
    </div>
  );
}
