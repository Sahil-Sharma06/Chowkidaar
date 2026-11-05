"use client";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { get, type Me, type Role } from "@/lib/api";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });

/**
 * Client-side guard. Not signed in: go to /login and come back here afterwards.
 * Signed in without this role: go to onboarding to turn it on. The API enforces the same rules.
 */
export function Guard({ role, children }: { role: Role; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const me = useMe();
  const allowed = me.data?.roles[role] === true;
  useEffect(() => {
    if (me.isError) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (me.data && !allowed) router.replace(`/onboarding?want=${role}`);
  }, [me.isError, me.data, allowed, role, path, router]);
  if (me.isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!allowed) return null;
  return <>{children}</>;
}
