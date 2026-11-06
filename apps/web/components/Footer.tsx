"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { get, type Config } from "@/lib/api";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";

export function Footer() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const testnet = !cfg.data?.network?.includes("mainnet");
  const link = "transition-colors hover:text-on-surface";
  return (
    <footer className="w-full border-t border-outline-variant/30 bg-surface-container-lowest py-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-xs text-on-surface-variant md:flex-row lg:px-12">
        <div className="flex flex-col items-center gap-1 md:items-start">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-on-surface"><ShieldCheck className="h-4 w-4 text-secondary" /> Chowkidaar</div>
          <p>© {new Date().getFullYear()} Chowkidaar{testnet ? " · Hedera testnet" : ""}</p>
        </div>
        <nav className="flex items-center gap-6">
          <Link className={link} href="/merchants">Merchants</Link>
          <Link className={link} href="/receipts">Receipts</Link>
          <a className={link} href={`${REPO}/blob/main/docs/API.md`} target="_blank" rel="noreferrer">Docs</a>
          <a className={link} href={REPO} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
