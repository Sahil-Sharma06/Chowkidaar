"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Store } from "lucide-react";
import { get, post, type AuthConfig, type Role } from "@/lib/api";
import { Alert, cx } from "@/lib/ui";
import { useMe } from "@/components/Guard";
import { MerchantVerify } from "@/components/MerchantVerify";

export default function OnboardingPage() {
  return <Suspense><Onboarding /></Suspense>;
}

const ROLES = [
  {
    role: "owner" as const, icon: Bot, title: "I run an AI agent",
    body: "Give your agent a protected way to pay for APIs. Set budgets, approve large payments, and get refunded automatically when a service fails.",
    home: "/owner",
  },
  {
    role: "merchant" as const, icon: Store, title: "I sell an API",
    body: "Get paid by agents per request. Post a bond so agents trust you, and build a public reputation. Needs a one-time World ID proof of human.",
    home: "/merchant/setup",
  },
];

function Onboarding() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const me = useMe();
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get<AuthConfig>("/api/auth/config") });
  const [picked, setPicked] = useState<Role | null>((params.get("want") as Role) || null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.isError) { router.replace("/login?next=/onboarding"); return null; }
  if (!me.data) return <div className="text-sm text-slate-500">Loading…</div>;

  const finish = async (role: Role) => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    router.push(ROLES.find((r) => r.role === role)!.home);
  };
  const enable = async (role: Role) => {
    setBusy(true); setError(null);
    try { await post("/api/me/roles", { role }); await finish(role); }
    catch { setError("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  const merchantNeedsProof = cfg.data?.idkit && !me.data.merchantVerified;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{me.data.roles.owner || me.data.roles.merchant ? "Add another role" : "Welcome! What brings you here?"}</h1>
        <p className="text-sm text-slate-600">You can do both with the same account, and add the other role later.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ROLES.map(({ role, icon: Icon, title, body, home }) => {
          const has = me.data!.roles[role];
          return (
            <button key={role} disabled={has} onClick={() => { setPicked(role); setError(null); }}
              className={cx("card text-left transition", picked === role && !has ? "ring-2 ring-blue-500" : "hover:bg-slate-50", has && "opacity-70")}>
              <div className="mb-2 flex items-center justify-between">
                <Icon className="h-6 w-6 text-blue-600" />
                {has && <span className="flex items-center gap-1 text-xs font-medium text-green-700"><Check className="h-4 w-4" /> Active</span>}
              </div>
              <div className="font-medium">{title}</div>
              <div className="mt-1 text-sm text-slate-600">{body}</div>
              {has && <a className="mt-3 inline-block text-sm text-blue-700 hover:underline" href={home} onClick={(e) => e.stopPropagation()}>Open →</a>}
            </button>
          );
        })}
      </div>

      {picked === "owner" && !me.data.roles.owner && (
        <div className="card space-y-3">
          <p className="text-sm text-slate-700">Next you&apos;ll register your agent and choose its spending limits. Nothing is paid until your agent makes a call.</p>
          <button className="btn-primary" disabled={busy} onClick={() => enable("owner")}>Continue as agent owner</button>
        </div>
      )}

      {picked === "merchant" && !me.data.roles.merchant && (
        <div className="card space-y-3">
          {merchantNeedsProof ? (
            <>
              <h2 className="font-medium">Prove you&apos;re a unique human</h2>
              <p className="text-sm text-slate-700">
                Merchants receive agents&apos; money and back it with a bond. If a merchant fails buyers, its bond is cut.
                A World ID proof of human makes sure that a merchant who loses its bond cannot simply sign up again under a new name.
                We only learn that you are one unique person: no name, no documents.
              </p>
              <MerchantVerify onDone={() => finish("merchant")} onError={setError} />
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">Next you&apos;ll connect your x402 endpoint and post a bond.</p>
              <button className="btn-primary" disabled={busy} onClick={() => enable("merchant")}>Continue as merchant</button>
            </>
          )}
        </div>
      )}

      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}
