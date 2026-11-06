"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { get, post, type ApprovalRow, type Config, type Me } from "@/lib/api";
import { cx } from "@/lib/ui";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";
type L = { href: string; label: string; badge?: number; external?: boolean };

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false); // mobile sheet
  const [menu, setMenu] = useState(false); // account menu
  const menuRef = useRef<HTMLDivElement>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => get<Me>("/api/me"), retry: false });
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const roles = me.data?.roles;
  const approvals = useQuery({
    queryKey: ["approvals", "pending"],
    queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"),
    enabled: roles?.owner === true, refetchInterval: 5000,
  });
  const pending = approvals.data?.length ?? 0;

  useEffect(() => { setOpen(false); setMenu(false); }, [path]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const primary: L[] = [
    { href: "/", label: "How it works" },
    { href: "/demo", label: "Sandbox" },
    { href: "/merchants", label: "Merchants" },
    { href: "/receipts", label: "Receipts" },
    { href: `${REPO}/blob/main/docs/API.md`, label: "Docs", external: true },
    ...(roles?.owner ? [{ href: "/console", label: "Console" }] : []),
  ];
  const mine: L[] = [
    ...(roles?.owner ? [{ href: "/console", label: "Agent console" }, { href: "/playground", label: "Playground" }, { href: "/owner", label: "My agents" }, { href: "/owner/approvals", label: "Approvals", badge: pending }] : []),
    ...(roles?.merchant ? [{ href: "/merchant", label: "My service" }, { href: "/merchant/bond", label: "Bond" }] : []),
    ...(me.data && !(roles?.owner && roles?.merchant) ? [{ href: "/onboarding", label: roles?.owner || roles?.merchant ? "Add a role" : "Get set up" }] : []),
  ];
  const net = cfg.data?.network === "hedera:mainnet" ? "Hedera mainnet" : "Hedera testnet";
  const name = me.data?.displayName ?? (me.data?.identity === "world-id" ? "Verified human" : "Dev user");
  const logout = async () => { try { await post("/api/logout"); } finally { qc.clear(); setMenu(false); setOpen(false); router.push("/"); } };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-outline-variant/30 bg-surface-container-lowest/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <motion.span whileHover={{ rotate: -8, scale: 1.08 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </motion.span>
          <span className="font-display text-base font-semibold tracking-tight">Chowkidaar</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-0.5 lg:flex">
          {primary.map((l) => <NavLink key={l.href} href={l.href} active={path === l.href} external={l.external}>{l.label}{l.label === "Console" && pending > 0 ? <Dot n={pending} /> : null}</NavLink>)}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-outline-variant/40 bg-surface-container-low px-3 py-1 md:flex">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-secondary" /></span>
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-on-surface-variant">{net}</span>
            {cfg.data?.hcsTopicId && <span className="hidden font-mono text-[10px] font-semibold text-secondary xl:inline">· HCS {cfg.data.hcsTopicId}</span>}
          </div>

          {me.data ? (
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}
                className={cx("flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium transition-colors hover:bg-surface-container", menu && "bg-surface-container")}>
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary text-on-primary">
                  <UserRound className="h-3.5 w-3.5" />
                  {pending > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-secondary ring-2 ring-surface-container-lowest" />}
                </span>
                <span className="hidden max-w-[120px] truncate sm:inline">{name}</span>
                <ChevronDown className={cx("h-3.5 w-3.5 text-on-surface-variant transition-transform", menu && "rotate-180")} />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.18 }}
                    className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl bg-surface-container-lowest p-1.5 shadow-lg ring-1 ring-outline-variant/40">
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{name}</div>
                        <div className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                          {me.data.identity === "world-id" ? <><ShieldCheck className="h-3 w-3 text-secondary" /> World ID verified</> : "Local dev login"}
                        </div>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-outline-variant/30" />
                    {mine.map((l) => (
                      <Link key={l.href} href={l.href} className={cx("flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm", path === l.href ? "bg-surface-container font-medium" : "hover:bg-surface-container-low")}>
                        {l.label}{l.badge ? <Dot n={l.badge} /> : null}
                      </Link>
                    ))}
                    <div className="my-1 h-px bg-outline-variant/30" />
                    <button type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"><LogOut className="h-3.5 w-3.5" /> Log out</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Link href="/login" className="btn-primary px-3.5 py-1.5 text-xs">Sign in</Link>
          )}
          <button type="button" className="btn-ghost p-1.5 lg:hidden" aria-label="Menu" onClick={() => setOpen((o) => !o)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-outline-variant/30 bg-surface-container-lowest lg:hidden">
            <div className="mx-auto flex max-w-7xl flex-col gap-0.5 px-4 py-3">
              {[...primary, ...(me.data ? mine.filter((l) => !primary.some((p) => p.href === l.href)) : [])].map((l) => (
                <Link key={l.href} href={l.href} target={l.external ? "_blank" : undefined}
                  className={cx("flex items-center justify-between rounded-md px-3 py-2 text-sm", path === l.href ? "bg-surface-container font-medium" : "text-on-surface-variant hover:bg-surface-container-low")}>
                  {l.label}{l.badge ? <Dot n={l.badge} /> : null}
                </Link>
              ))}
              {me.data ? <button type="button" onClick={logout} className="rounded-md px-3 py-2 text-left text-sm text-on-surface-variant hover:bg-surface-container-low">Log out</button>
                : <Link href="/login" className="btn-primary mt-1">Sign in</Link>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Dot({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-full bg-secondary-container px-1.5 text-[10px] font-semibold text-on-secondary-container">{n}</span>;
}

function NavLink({ href, active, external, children }: { href: string; active: boolean; external?: boolean; children: React.ReactNode }) {
  const cls = cx("relative inline-flex items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors", active ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface");
  if (external) return <a className={cls} href={href} target="_blank" rel="noreferrer">{children}</a>;
  return (
    <Link className={cls} href={href}>
      {children}
      {active && <motion.span layoutId="nav-underline" className="absolute inset-x-2.5 -bottom-[13px] h-[2px] rounded-full bg-secondary" />}
    </Link>
  );
}
