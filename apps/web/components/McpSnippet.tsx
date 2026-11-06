"use client";
import { useState } from "react";
import { Bot, ListChecks, Receipt, Wallet } from "lucide-react";
import { GATEWAY_URL } from "@/lib/api";
import { Segmented } from "@/components/owner/kit";
import { CodeEditor, type EditorFile } from "@/components/landing/editor";

const SERVER = "<path-to-Chowkidaar>/packages/mcp/src/index.ts";
const KEY_PLACEHOLDER = "<this agent's API key>";

type Client = "claude-desktop" | "cursor" | "claude-code";
const CLIENTS = [["claude-desktop", "Claude Desktop"], ["cursor", "Cursor"], ["claude-code", "Claude Code"]] as const;

/** Where each assistant keeps its MCP config, and what to do after pasting. */
const STEPS: Record<Client, [string, string][]> = {
  "claude-desktop": [
    ["Open the config", "Settings › Developer › Edit Config opens claude_desktop_config.json."],
    ["Paste the server", "Add the chowkidaar entry below inside mcpServers."],
    ["Restart Claude", "Quit and reopen the app. Chowkidaar appears in the tools menu."],
  ],
  cursor: [
    ["Open the config", "Cursor Settings › MCP › Add new global MCP server opens ~/.cursor/mcp.json."],
    ["Paste the server", "Add the chowkidaar entry below inside mcpServers."],
    ["Turn it on", "Back in Settings › MCP, switch chowkidaar on and wait for its tools to load."],
  ],
  "claude-code": [
    ["Open a terminal", "Any folder works. The server is added for your user, so every project can use it."],
    ["Run the command", "It registers the server with this agent's key."],
    ["Restart Claude Code", "Start a new session and ask it to buy something."],
  ],
};

const TOOLS = [
  [Bot, "ask", "Pays for what you ask in plain words, inside this agent's limits."],
  [ListChecks, "list_merchants", "Shows what this agent is allowed to buy, with prices and scores."],
  [Wallet, "wallet", "Balance, limits and what it has spent today."],
  [Receipt, "get_receipt", "Follows a payment until it is delivered or refunded."],
] as const;

/** How to let Claude, Cursor or Claude Code pay through this agent: pick the assistant, follow three steps. */
export function McpSnippet({ apiKey }: { apiKey?: string }) {
  const [client, setClient] = useState<Client>("claude-desktop");
  const key = apiKey ?? KEY_PLACEHOLDER;
  const json = JSON.stringify({
    mcpServers: {
      chowkidaar: {
        command: "npx",
        args: ["-y", "tsx", SERVER],
        env: { CHOWKIDAAR_URL: GATEWAY_URL, CHOWKIDAAR_AGENT_KEY: key },
      },
    },
  }, null, 2);
  const shell = [
    "$ claude mcp add chowkidaar --scope user \\",
    `    -e CHOWKIDAAR_URL=${GATEWAY_URL} \\`,
    `    -e CHOWKIDAAR_AGENT_KEY="${key}" \\`,
    `    -- npx -y tsx ${SERVER}`,
  ].join("\n");
  const markKey = (l: string) => l.includes("CHOWKIDAAR_AGENT_KEY");
  const file: EditorFile = client === "claude-code"
    ? { id: "cc", name: "Terminal", lang: "sh", code: shell, mark: markKey }
    : { id: client, name: client === "cursor" ? "mcp.json" : "claude_desktop_config.json", lang: "json", code: json, mark: markKey };

  return (
    <section aria-labelledby="mcp-title" className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[52ch]">
          <h2 id="mcp-title" className="font-display text-xl font-semibold tracking-[-0.01em]">Connect an AI assistant</h2>
          <p className="mt-1 text-sm text-on-surface-variant">Your assistant gets four tools and can pay through this agent, never past its limits.</p>
        </div>
        <Segmented label="Assistant" value={client} onChange={setClient} options={CLIENTS} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <ol className="space-y-2">
          {STEPS[client].map(([title, body], i) => (
            <li key={title} className="well flex gap-3.5 p-4">
              <span className="money flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{title}</div>
                <div className="mt-0.5 text-sm text-on-surface-variant">{body}</div>
              </div>
            </li>
          ))}
          {!apiKey && (
            <li className="px-1 pt-2 text-xs leading-relaxed text-outline">
              Replace the highlighted placeholder with the API key you saved when you created this agent. Lost it? Replace the key above to get a new one.
            </li>
          )}
        </ol>
        <CodeEditor key={file.id} files={[file]} label="Configuration" quiet />
      </div>

      <div className="mt-6 border-t border-rule pt-5">
        <h3 className="text-sm font-medium">What your assistant can do</h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {TOOLS.map(([Icon, name, body]) => (
            <li key={name} className="flex gap-3 rounded-2xl p-3 ring-1 ring-inset ring-rule">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden />
              <div className="min-w-0">
                <code className="font-mono text-[13px] text-on-surface">{name}</code>
                <p className="mt-0.5 text-sm text-on-surface-variant">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
