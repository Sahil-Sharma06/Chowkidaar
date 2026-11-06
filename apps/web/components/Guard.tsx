"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError, get, type Me, type Role } from "@/lib/api";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });

/** True when the session is missing or expired, as opposed to the server being unreachable. */
export const isSignedOut = (e: unknown) => e instanceof ApiError && e.status === 401;

/**
 * Client-side guard. Not signed in: go to /login and come back here afterwards.
 * Signed in without this role: go to onboarding to turn it on. The API enforces the same rules.
 * Any other failure (network, server down) shows an error with a retry instead of signing you out.
 */
export function Guard({ role, children }: { role: Role; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const me = useMe();
  const allowed = me.data?.roles[role] === true;
  const signedOut = me.isError && isSignedOut(me.error);
  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (me.data && !allowed) router.replace(`/onboarding?want=${role}`);
  }, [signedOut, me.data, allowed, role, path, router]);
  if (me.isLoading) return <div className="space-y-4" aria-busy><div className="skeleton h-9 w-56" /><div className="grid gap-5 lg:grid-cols-12"><div className="skeleton h-72 lg:col-span-7" /><div className="skeleton h-72 lg:col-span-5" /></div></div>;
  if (me.isError && !signedOut) return <ReachError retry={() => me.refetch()} busy={me.isFetching} />;
  if (!allowed) return null;
  return <>{children}</>;
}

export function ReachError({ retry, busy }: { retry: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="mx-auto flex min-h-[50vh] max-w-sm flex-col items-center justify-center gap-4 text-center">
      <p className="text-[15px] text-on-surface-variant">Couldn&apos;t reach Chowkidaar. Check your connection and try again.</p>
      <button type="button" className="btn-secondary" onClick={retry} disabled={busy}>Try again{busy ? "…" : ""}</button>
    </div>
  );
}
