"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronDown, LogOut, Menu, X } from "lucide-react";
import { get, post, type ApprovalRow, type Config, type Me } from "@/lib/api";
import { cx } from "@/lib/ui";
import { Logo } from "@/components/Logo";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";
const DOCS = `${REPO}/blob/main/docs/API.md`;
const EASE = [0.2, 0, 0, 1] as const;
type L = { href: string; label: string; external?: boolean; match?: (p: string) => boolean };

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
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

  // Account menu is a disclosure: click outside closes it; Escape closes it and puts focus back on its button.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); triggerRef.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  // Signed-in people see their workspace first; everyone sees the public directory.
  const links: L[] = [
    ...(roles?.owner ? [
      { href: "/owner", label: "Dashboard", match: (p: string) => p === "/owner" || p.startsWith("/owner/agents") },
      { href: "/console", label: "Console" },
    ] : []),
    ...(roles?.merchant ? [
      { href: "/merchant", label: roles.owner ? "My service" : "Dashboard", match: (p: string) => p === "/merchant" || p === "/merchant/setup" },
      { href: "/merchant/bond", label: "Bond" },
    ] : []),
    { href: "/merchants", label: "Merchants" },
    { href: "/receipts", label: "Receipts", match: (p: string) => p.startsWith("/receipts") },
    ...(!me.data ? [{ href: DOCS, label: "Docs", external: true }] : []),
  ];
  const isActive = (l: L) => (l.match ? l.match(path) : path === l.href);
  const name = me.data?.displayName ?? (me.data?.identity === "world-id" ? "Verified human" : "Dev user");
  const testnet = !cfg.data?.network?.includes("mainnet");
  const logout = async () => { try { await post("/api/logout"); } finally { qc.clear(); setMenu(false); setOpen(false); router.push("/"); } };
  const pendingText = pending === 1 ? "1 payment waiting for your approval" : `${pending} payments waiting for your approval`;

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href={me.data && roles?.owner ? "/owner" : "/"} className="flex shrink-0 items-center gap-2 rounded-full">
          <Logo className="h-7 w-7" />
          <span className="font-display text-[18px] font-semibold tracking-[-0.025em]">Chowkidaar</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {links.map((l) => <Tab key={l.href} l={l} active={isActive(l)} />)}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {testnet && <span className="hidden rounded-full border border-rule px-3 py-1 text-xs text-on-surface-variant md:inline">Testnet</span>}

          {roles?.owner && (
            <>
              <Link href="/owner/approvals" aria-label={pending ? pendingText : "Approvals"}
                className={cx("relative flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-low transition-colors after:absolute after:-inset-1 hover:bg-surface-container", path === "/owner/approvals" ? "text-primary" : "text-on-surface-variant hover:text-on-surface")}>
                <Bell className="h-4 w-4" />
                {pending > 0 && <span aria-hidden className="money absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold leading-none text-on-primary">{pending}</span>}
              </Link>
              <span role="status" className="sr-only">{pending > 0 ? pendingText : ""}</span>
            </>
          )}

          {me.data ? (
            <div className="relative" ref={menuRef}>
              <button ref={triggerRef} type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-controls="account-menu"
                className={cx("flex h-10 items-center gap-2 rounded-full pl-1.5 pr-3 text-sm transition-colors hover:bg-surface-container-low", menu && "bg-surface-container-low")}>
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold">{name.slice(0, 1).toUpperCase()}</span>
                <span className="hidden max-w-[120px] truncate sm:inline">{name}</span>
                <span className="sr-only sm:hidden">Account</span>
                <ChevronDown aria-hidden className={cx("h-3.5 w-3.5 text-on-surface-variant transition-transform duration-200 ease-out-soft", menu && "rotate-180")} />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div id="account-menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15, ease: EASE }}
                    className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-2xl border border-rule-strong bg-surface-container-lowest p-1.5 shadow-[0_12px_32px_-12px_rgb(16_16_20/0.18)]">
                    <div className="px-3 py-2.5">
                      <div className="truncate text-sm font-medium">{name}</div>
                      <div className="text-xs text-on-surface-variant">{me.data.identity === "world-id" ? "Verified with World ID" : "Signed in with dev login"}</div>
                    </div>
                    <div className="my-1 h-px bg-rule" />
                    <ul>
                      {!(roles?.owner && roles?.merchant) && (
                        <li><MenuLink href="/onboarding">{roles?.owner ? "Sell a service too" : roles?.merchant ? "Run agents too" : "Finish setting up"}</MenuLink></li>
                      )}
                      <li><MenuLink href={DOCS} external>API docs</MenuLink></li>
                    </ul>
                    <div className="my-1 h-px bg-rule" />
                    <button type="button" onClick={logout} className="flex min-h-10 w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface">
                      <LogOut aria-hidden className="h-3.5 w-3.5" /> Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : !me.isLoading && (
            <div className="flex items-center gap-1">
              <Link href="/login" className="btn-ghost hidden sm:inline-flex">Sign in</Link>
              {/* The landing hero already carries the lime call to action; here it stays outlined. */}
              <Link href="/login" className={path === "/" ? "btn-secondary" : "btn-primary"}>Create an agent</Link>
            </div>
          )}

          <button ref={toggleRef} type="button" className="flex size-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
            {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav id="mobile-nav" aria-label="Mobile" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: EASE }}
            className="border-t border-rule lg:hidden">
            <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3">
              {links.map((l) => l.external ? (
                <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex min-h-11 items-center rounded-xl px-3 text-[15px] text-on-surface-variant">{l.label}</a>
              ) : (
                <Link key={l.href} href={l.href} aria-current={isActive(l) ? "page" : undefined}
                  className={cx("flex min-h-11 items-center rounded-xl px-3 text-[15px]", isActive(l) ? "bg-surface-container-low font-medium" : "text-on-surface-variant")}>
                  {l.label}
                </Link>
              ))}
              {me.data && <button type="button" onClick={logout} className="flex min-h-11 items-center rounded-xl px-3 text-left text-[15px] text-on-surface-variant">Sign out</button>}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function Tab({ l, active }: { l: L; active: boolean }) {
  const cls = cx("relative inline-flex min-h-10 items-center rounded-full px-3.5 text-sm transition-colors",
    active ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface");
  if (l.external) return <a className={cls} href={l.href} target="_blank" rel="noreferrer">{l.label}</a>;
  return (
    <Link className={cls} href={l.href} aria-current={active ? "page" : undefined}>
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-full bg-surface-container-low" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
      {l.label}
    </Link>
  );
}

function MenuLink({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  const cls = "flex min-h-10 items-center rounded-[10px] px-3 py-2 text-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface";
  return external
    ? <a className={cls} href={href} target="_blank" rel="noreferrer">{children}</a>
    : <Link className={cls} href={href}>{children}</Link>;
}
