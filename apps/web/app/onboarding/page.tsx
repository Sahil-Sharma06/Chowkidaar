"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Store } from "lucide-react";
import { get, post, type AuthConfig, type Role } from "@/lib/api";
import { Alert, cx } from "@/lib/ui";
import { ReachError, isSignedOut, useMe } from "@/components/Guard";
import { MerchantVerify } from "@/components/MerchantVerify";

export default function OnboardingPage() {
  return <Suspense><Onboarding /></Suspense>;
}

const ROLES = [
  {
    role: "owner" as const, icon: Bot, title: "Run agents", open: "Open dashboard",
    body: "Give your AI agent a safe way to pay for APIs. Set its budget, approve large payments, and get refunded automatically when a service fails.",
    home: "/owner",
  },
  {
    role: "merchant" as const, icon: Store, title: "Sell an API", open: "Open my service",
    body: "Get paid by agents for every request. Post a bond so agents trust you and build a public reputation. Needs a one-time World ID check.",
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
  const signedOut = me.isError && isSignedOut(me.error);

  useEffect(() => { if (signedOut) router.replace("/login?next=/onboarding"); }, [signedOut, router]);

  if (me.isError) return signedOut ? null : <ReachError retry={() => me.refetch()} busy={me.isFetching} />;
  if (!me.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-4" aria-busy>
        <div className="skeleton h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2"><div className="skeleton h-56 rounded-[24px]" /><div className="skeleton h-56 rounded-[24px]" /></div>
      </div>
    );
  }

  const finish = async (role: Role) => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    router.push(ROLES.find((r) => r.role === role)!.home);
  };
  const enable = async (role: Role) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await post("/api/me/roles", { role }); await finish(role); }
    catch { setError("Couldn't turn on that role. Check your connection and try again."); }
    finally { setBusy(false); }
  };

  const merchantNeedsProof = cfg.data?.idkit && !me.data.merchantVerified;
  const returning = me.data.roles.owner || me.data.roles.merchant;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4 sm:space-y-8">
      <div className="space-y-2">
        <h1 id="onboarding-title" className="font-display text-[28px] font-semibold leading-tight tracking-tight sm:text-[32px]">{returning ? "Add another role" : "What do you want to do?"}</h1>
        <p className="text-sm text-on-surface-variant">One account can do both. You can add the other role at any time.</p>
      </div>

      {/* Roles you already have are plain cards with a link; only the others are radios (native, so arrow keys work). */}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        {ROLES.map(({ role, icon: Icon, title, body, home, open }) => {
          const has = me.data!.roles[role];
          const on = picked === role && !has;
          const head = (
            <div className="flex items-start justify-between gap-4">
              <span aria-hidden className={cx("flex h-12 w-12 items-center justify-center rounded-2xl transition-colors", on ? "bg-surface-container-high text-on-surface" : "bg-surface-container text-on-surface-variant")}>
                <Icon className="h-5 w-5" />
              </span>
              {has ? <span className="pill pill-ok"><Check aria-hidden className="h-3.5 w-3.5" /> Active</span> : (
                <span aria-hidden className={cx("flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary text-on-primary" : "border-field")}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              )}
            </div>
          );
          const text = (
            <>
              <div className="mt-8 font-display text-xl font-semibold tracking-[-0.01em]">{title}</div>
              <p id={`role-${role}-body`} className="mt-2 text-sm leading-relaxed text-on-surface-variant">{body}</p>
            </>
          );
          return has ? (
            <div key={role} className="panel flex flex-col">
              {head}{text}
              <Link className="btn-secondary mt-5 self-start" href={home}>{open}</Link>
            </div>
          ) : (
            <label key={role}
              className={cx("panel block cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                on ? "ring-2 ring-primary" : "hover:bg-surface-container-low")}>
              <input type="radio" name="role" value={role} checked={on} className="sr-only" aria-describedby={`role-${role}-body`}
                onChange={() => { setPicked(role); setError(null); }} />
              {head}{text}
            </label>
          );
        })}
      </div>

      {picked === "owner" && !me.data.roles.owner && (
        <section className="panel flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md">
            <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Next, create your first agent</h2>
            <p className="mt-1 text-sm text-on-surface-variant">You&apos;ll give it a wallet and spending limits. Nothing is paid until your agent makes a call.</p>
          </div>
          <button type="button" className="btn-primary h-11 shrink-0 px-5" disabled={busy} onClick={() => enable("owner")}>{busy ? "Setting up…" : "Continue as agent owner"}</button>
        </section>
      )}

      {picked === "merchant" && !me.data.roles.merchant && (
        merchantNeedsProof ? (
          <section className="panel space-y-5">
            <div className="max-w-xl">
              <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Prove you&apos;re a unique human</h2>
              <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                Merchants receive agents&apos; money and back it with a bond. If a merchant fails buyers, its bond is cut.
                A World ID check makes sure a merchant who loses its bond can&apos;t sign up again under a new name.
                We only learn that you are one unique person: no name, no documents.
              </p>
            </div>
            <div className="sm:max-w-xs"><MerchantVerify onDone={() => finish("merchant")} onError={setError} /></div>
          </section>
        ) : (
          <section className="panel flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-md">
              <h2 className="font-display text-xl font-semibold tracking-[-0.01em]">Next, set up your service</h2>
              <p className="mt-1 text-sm text-on-surface-variant">You&apos;ll connect your x402 endpoint and post a bond.</p>
            </div>
            <button type="button" className="btn-primary h-11 shrink-0 px-5" disabled={busy} onClick={() => enable("merchant")}>{busy ? "Setting up…" : "Continue as merchant"}</button>
          </section>
        )
      )}

      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}
