"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { get, post, type ApprovalRow, type Config, type Me } from "@/lib/api";
import { cx } from "@/lib/ui";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const roles = me.data?.roles;
  const approvals = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"),
    enabled: roles?.owner === true, refetchInterval: 5000,
  });

  const links: { href: string; label: string; badge?: number; external?: boolean }[] = [
    { href: "/", label: "How it works" },
    { href: "/demo", label: "Sandbox demo" },
    { href: "/merchants", label: "Public merchants" },
    { href: "/receipts", label: "Receipt explorer" },
    { href: `${REPO}#readme`, label: "Docs", external: true },
  ];
  const mine: { href: string; label: string; badge?: number }[] = [
    ...(roles?.owner ? [{ href: "/console", label: "Console" }, { href: "/playground", label: "Playground" }, { href: "/owner", label: "My agents" }, { href: "/owner/approvals", label: "Approvals", badge: approvals.data?.length ?? 0 }] : []),
    ...(roles?.merchant ? [{ href: "/merchant", label: "My service" }, { href: "/merchant/bond", label: "Bond" }] : []),
    ...(me.data && !(roles?.owner && roles?.merchant) ? [{ href: "/onboarding", label: roles?.owner || roles?.merchant ? "Add role" : "Get set up" }] : []),
  ];
  const net = cfg.data?.network === "hedera:mainnet" ? "Hedera mainnet" : "Hedera testnet";
  const logout = async () => { try { await post("/api/logout"); } finally { qc.clear(); setOpen(false); router.push("/"); } };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-outline-variant/30 bg-surface-container-lowest/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6 lg:px-12">
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center gap-2.5">
            <motion.span whileHover={{ rotate: -8, scale: 1.08 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </motion.span>
            <span className="font-display text-base font-semibold tracking-tight">Chowkidaar</span>
          </Link>
          <nav className="hidden items-center gap-1 xl:flex">
            {links.map((l) => (
              <NavLink key={l.href} href={l.href} active={path === l.href} external={l.external}>{l.label}</NavLink>
            ))}
            {mine.length > 0 && <span className="mx-2 h-4 w-px bg-outline-variant/60" />}
            {mine.map((l) => (
              <NavLink key={l.href} href={l.href} active={path === l.href}>
                {l.label}{l.badge ? <span className="ml-1.5 rounded-full bg-secondary-container px-1.5 text-[10px] font-semibold text-on-secondary-container">{l.badge}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-1 sm:flex">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-secondary" /></span>
            <span className="eyebrow text-on-surface-variant">{net}</span>
            {cfg.data?.hcsTopicId && <span className="font-mono text-[10px] font-semibold text-secondary">HCS {cfg.data.hcsTopicId}</span>}
          </div>
          {me.data ? (
            <>
              {me.data.identity === "world-id" && (
                <div className="hidden items-center gap-1.5 rounded-lg border border-secondary/30 bg-secondary-container/20 px-2.5 py-1 font-mono text-[10px] font-medium text-on-secondary-container md:flex">
                  <ShieldCheck className="h-3.5 w-3.5" /> World ID verified
                </div>
              )}
              <span className="hidden text-xs text-on-surface-variant lg:inline">{me.data.displayName ?? (me.data.identity === "world-id" ? "Verified human" : "Dev user")}</span>
              <button onClick={logout} className="hidden text-xs text-on-surface-variant hover:text-on-surface lg:inline">Log out</button>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary"><UserRound className="h-4 w-4" /></span>
            </>
          ) : (
            <Link href="/login" className="btn-primary hidden px-3.5 py-1.5 text-xs sm:inline-flex">Sign in</Link>
          )}
          <button className="btn-ghost p-1.5 xl:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-outline-variant/30 bg-surface-container-lowest xl:hidden">
            <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-3">
              {[...links, ...mine].map((l) => (
                <Link key={l.href} href={l.href} onClick={() => setOpen(false)} target={"external" in l && l.external ? "_blank" : undefined}
                  className={cx("rounded-md px-3 py-2 text-sm", path === l.href ? "bg-surface-container font-medium" : "text-on-surface-variant hover:bg-surface-container-low")}>
                  {l.label}
                </Link>
              ))}
              {me.data ? <button onClick={logout} className="rounded-md px-3 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-container-low">Log out</button>
                : <Link href="/login" onClick={() => setOpen(false)} className="btn-primary mt-1">Sign in</Link>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function NavLink({ href, active, external, children }: { href: string; active: boolean; external?: boolean; children: React.ReactNode }) {
  const cls = cx("relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors", active ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface");
  const underline = active && <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full bg-secondary" />;
  if (external) return <a className={cls} href={href} target="_blank" rel="noreferrer">{children}</a>;
  return <Link className={cls} href={href}>{children}{underline}</Link>;
}
