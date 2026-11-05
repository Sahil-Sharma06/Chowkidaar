"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { get, type Me } from "@/lib/api";

/** Client-side guard: redirects to /login unless the session has the given role. */
export function Guard({ role, children }: { role: "owner" | "merchant"; children: React.ReactNode }) {
  const router = useRouter();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });
  useEffect(() => {
    if (me.isError || (me.data && me.data.role !== role)) router.replace(`/login?role=${role}`);
  }, [me.isError, me.data, role, router]);
  if (me.isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!me.data || me.data.role !== role) return null;
  return <>{children}</>;
}
