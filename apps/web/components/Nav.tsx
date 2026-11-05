"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { get, post, type ApprovalRow, type Me } from "@/lib/api";
import { cx } from "@/lib/ui";

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });
  const approvals = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"),
    enabled: me.data?.role === "owner", refetchInterval: 3000,
  });

  const links = [
    { href: "/demo", label: "Live demo" },
    { href: "/merchants", label: "Merchants" },
    ...(me.data?.role === "owner" ? [{ href: "/owner", label: "Owner" }, { href: "/owner/approvals", label: "Approvals", badge: approvals.data?.length ?? 0 }] : []),
    ...(me.data?.role === "merchant" ? [{ href: "/merchant", label: "Merchant" }, { href: "/merchant/bond", label: "Bond" }] : []),
  ];

  return (
    <header className="bg-[var(--navy)] text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-blue-400" /> Agent Payment Protection</Link>
        <nav className="flex flex-1 items-center gap-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={cx("rounded-md px-3 py-1.5 hover:bg-white/10", path === l.href && "bg-white/15")}>
              {l.label}
              {"badge" in l && l.badge ? <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-slate-900">{l.badge}</span> : null}
            </Link>
          ))}
        </nav>
        {me.data ? (
          <button className="text-sm text-slate-300 hover:text-white" onClick={async () => { await post("/api/logout"); qc.clear(); router.push("/"); }}>Log out</button>
        ) : (
          <Link href="/login" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500">Get started</Link>
        )}
      </div>
    </header>
  );
}
