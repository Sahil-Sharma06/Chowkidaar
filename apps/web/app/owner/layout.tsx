"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Guard } from "@/components/Guard";
import { get, type AgentRow } from "@/lib/api";
import { cx } from "@/lib/ui";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Guard role="owner">
      <AgentSwitcher />
      <div className="min-w-0">{children}</div>
    </Guard>
  );
}

/** Agents as pills under the main nav: one tap to any agent, plus the way to add one. */
function AgentSwitcher() {
  const path = usePathname();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<AgentRow[]>("/api/agents") });
  if (!agents.data?.length || path === "/owner/approvals") return null;
  const pill = (active: boolean) => cx(
    "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-colors",
    active ? "bg-surface-container-low text-on-surface" : "text-on-surface-variant hover:text-on-surface",
  );
  return (
    <nav aria-label="Agents" className="-mx-1 mb-8 flex items-center gap-1 overflow-x-auto px-1 pb-1">
      <Link href="/owner" aria-current={path === "/owner" ? "page" : undefined} className={pill(path === "/owner")}>All agents</Link>
      <span className="mx-1 h-4 w-px shrink-0 bg-rule" aria-hidden />
      {agents.data.map((a) => (
        <Link key={a.id} href={`/owner/agents/${a.id}`} aria-current={path === `/owner/agents/${a.id}` ? "page" : undefined} className={pill(path === `/owner/agents/${a.id}`)}>
          {a.name}
          {a.status === "paused" && <span className="text-xs text-outline">Paused</span>}
        </Link>
      ))}
      <Link href="/owner/agents/new" aria-current={path === "/owner/agents/new" ? "page" : undefined} className={pill(path === "/owner/agents/new")}><Plus className="h-3.5 w-3.5" aria-hidden /> New agent</Link>
    </nav>
  );
}
