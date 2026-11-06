"use client";
import { GATEWAY_URL } from "@/lib/api";
import { CopyButton } from "@/lib/ui";

/** Claude Desktop / Cursor / ChatGPT config that lets the host pay through this agent. */
export function McpSnippet({ apiKey }: { apiKey?: string }) {
  const cfg = JSON.stringify({
    mcpServers: {
      chowkidaar: {
        command: "npx",
        args: ["-y", "tsx", "<path-to-Chowkidaar>/packages/mcp/src/index.ts"],
        env: { CHOWKIDAAR_URL: GATEWAY_URL, CHOWKIDAAR_AGENT_KEY: apiKey ?? "<this agent's API key>" },
      },
    },
  }, null, 2);
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Use from Claude, ChatGPT or Cursor</h2>
          <p className="text-sm text-on-surface-variant">Add this MCP server to your assistant and it can pay through this agent, inside the limits above. Tools: <code>ask</code>, <code>list_merchants</code>, <code>wallet</code>, <code>get_receipt</code>.</p>
        </div>
        <CopyButton text={cfg} />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-surface-container-low p-3 font-mono text-xs">{cfg}</pre>
      <p className="text-xs text-on-surface-variant">Claude Desktop: Settings → Developer → Edit Config. {apiKey ? "The key above is shown once." : "Paste the API key you saved when the agent was created, or replace the key to get a new one."}</p>
    </section>
  );
}
