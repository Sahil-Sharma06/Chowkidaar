import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const isPrivate = (ip: string) => {
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.replace(/^::ffff:/, ""));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** Throws unless the URL is safe to call from the gateway. DEMO_MODE allows http and localhost. */
export async function assertSafeUrl(raw: string, demoMode: boolean) {
  const u = new URL(raw);
  if (demoMode) return;
  if (u.protocol !== "https:") throw new Error("endpoint_must_be_https");
  const host = u.hostname;
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (ips.length === 0 || ips.some(isPrivate)) throw new Error("endpoint_not_public");
}
