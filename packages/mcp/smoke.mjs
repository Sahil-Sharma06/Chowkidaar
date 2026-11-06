// Drives the Chowkidaar MCP server over stdio exactly like Claude Desktop would.
//   CHOWKIDAAR_AGENT_KEY=apk_... node smoke.mjs ["what to ask for"]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", join(here, "src/index.ts")],
  env: { ...process.env, CHOWKIDAAR_URL: process.env.CHOWKIDAAR_URL ?? "http://localhost:4000" },
  cwd: here,
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const show = (r) => console.log(r.content.map((c) => c.text).join("\n"), "\n---");
show(await client.callTool({ name: "wallet", arguments: {} }));
show(await client.callTool({ name: "list_merchants", arguments: { category: process.env.CATEGORY ?? "music" } }));
const what = process.argv[2];
if (what) show(await client.callTool({ name: "ask", arguments: { query: what } }));
await client.close();
