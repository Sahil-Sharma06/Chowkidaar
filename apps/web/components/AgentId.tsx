"use client";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { HASHSCAN, get, type Config } from "@/lib/api";
import { CopyButton, cx } from "@/lib/ui";

/** "uaid:aid:9Pk249…;…nativeId=hedera:testnet:0.0.x" → "uaid:aid:9Pk249…dn7dm8" : long ids stay readable. */
const shorten = (uaid: string) => {
  const head = uaid.split(";")[0];
  return head.length > 24 ? `${head.slice(0, 15)}…${head.slice(-6)}` : head;
};

/**
 * An agent's HCS-14 Universal Agent ID: a public identity derived from its name and Hedera account,
 * announced on the HCS topic. Shown short, copied in full, with a link to the announcement.
 */
export function AgentId({ uaid, seq, className }: { uaid: string; seq?: number | null; className?: string }) {
  const cfg = useQuery({ queryKey: ["config"], queryFn: () => get<Config>("/api/public/config"), staleTime: 60_000 });
  const topic = cfg.data?.hcsTopicId;
  return (
    <span className={cx("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="pill pill-muted h-[22px] px-2" title="HCS-14 Universal Agent ID">HCS-14</span>
      <code className="min-w-0 truncate font-mono text-xs text-on-surface-variant" title={uaid}>{shorten(uaid)}</code>
      <CopyButton text={uaid} label="Copy agent ID" />
      {seq != null && topic && (
        <a className="inline-flex min-h-8 items-center gap-1 text-xs text-on-surface-variant underline decoration-outline underline-offset-4 transition-colors hover:text-on-surface"
          href={`${HASHSCAN}/topic/${topic}?seq=${seq}`} target="_blank" rel="noreferrer">
          Registered on Hedera <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens HashScan)</span>
        </a>
      )}
    </span>
  );
}
