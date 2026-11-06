"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";

/** Full footer on public pages; signed-in workspaces stay clean and get none. */
export function Footer() {
  const path = usePathname();
  if (/^\/(owner|merchant|console|playground|onboarding|login)(\/|$)/.test(path)) return null;
  const link = "text-on-surface-variant transition-colors hover:text-on-surface";
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between lg:px-8">
        <div className="max-w-xs">
          <div className="flex items-center gap-2.5"><Logo className="h-6 w-6" /><span className="font-display font-semibold tracking-[-0.02em]">Chowkidaar</span></div>
          <p className="mt-3 text-sm text-on-surface-variant">Spending limits and automatic refunds for AI agents that pay for APIs.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-16 gap-y-2 text-sm">
          <Link className={link} href="/merchants">Merchants</Link>
          <a className={link} href={`${REPO}/blob/main/docs/API.md`} target="_blank" rel="noreferrer">API docs</a>
          <Link className={link} href="/receipts">Receipts</Link>
          <a className={link} href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          <Link className={link} href="/onboarding?want=merchant">Sell an API</Link>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-8 text-xs text-outline sm:px-6 lg:px-8">© {new Date().getFullYear()} Chowkidaar. Running on Hedera testnet.</div>
    </footer>
  );
}
