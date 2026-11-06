"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { get, HASHSCAN, type Config } from "@/lib/api";

const REPO = "https://github.com/Sahil-Sharma06/Chowkidaar";

export function Footer() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const c = cfg.data;
  const net = c?.network === "hedera:mainnet" ? "Hedera mainnet" : "Hedera testnet";
  return (
    <footer className="w-full border-t border-outline-variant/30 bg-surface-container-lowest py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-12">
        <div className="grid grid-cols-1 gap-8 border-b border-outline-variant/20 pb-10 md:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-display text-base font-semibold"><ShieldCheck className="h-5 w-5 text-secondary" /> Chowkidaar</div>
            <p className="text-xs leading-relaxed text-on-surface-variant">Bond-backed refund gateway for AI agents paying over x402 on Hedera. Objective checks, on-chain refunds, public receipts.</p>
          </div>
          <Col title="Protocol" links={[
            [c?.hcsTopicId ? `${HASHSCAN}/topic/${c.hcsTopicId}` : `${HASHSCAN}`, "Hedera HCS receipts"],
            ["/merchants", "Arkiv reputation"],
            ["/login", "World ID Agent Pass"],
            ["https://www.x402.org", "x402 payment protocol"],
          ]} />
          <Col title="Resources" links={[
            [`${REPO}#readme`, "Docs & README"],
            ["/demo", "Sandbox demo"],
            ["/receipts", "Receipt explorer"],
            ["/merchants", "Bonded merchant catalog"],
          ]} />
          <div>
            <div className="eyebrow mb-3 text-on-surface">Gateway status</div>
            <dl className="space-y-2.5 text-xs">
              <Row k="Network" v={net} />
              <Row k="Vault" v={c ? <a className="font-mono hover:underline" href={`${HASHSCAN}/account/${c.vaultAccount}`} target="_blank" rel="noreferrer">{c.vaultAccount}</a> : "—"} />
              <Row k="Fee" v={c ? `${c.feeBps / 100}% per call` : "—"} />
              <Row k="Penalty" v={c ? `${c.penaltyBps / 100}% of price` : "—"} />
            </dl>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 pt-8 text-xs text-on-surface-variant md:flex-row">
          <p>© {new Date().getFullYear()} Chowkidaar · ETHGlobal Mumbai · {c?.network?.includes("mainnet") ? "" : "Testnet only. "}The bond vault is custodial in this version.</p>
          <div className="flex items-center gap-6">
            <a className="hover:text-on-surface" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <a className="hover:text-on-surface" href={`${REPO}/blob/main/WORLD.md`} target="_blank" rel="noreferrer">World ID notes</a>
            <a className="hover:text-on-surface" href={`${REPO}/tree/main/arkiv`} target="_blank" rel="noreferrer">Arkiv notes</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function Col({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="eyebrow mb-3 text-on-surface">{title}</div>
      <ul className="space-y-2 text-xs text-on-surface-variant">
        {links.map(([href, label]) => (
          <li key={label}>
            {href.startsWith("http") ? <a className="transition-colors hover:text-on-surface" href={href} target="_blank" rel="noreferrer">{label}</a>
              : <Link className="transition-colors hover:text-on-surface" href={href}>{label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="eyebrow text-on-surface-variant">{k}</dt><dd className="font-medium text-on-surface">{v}</dd></div>;
}
