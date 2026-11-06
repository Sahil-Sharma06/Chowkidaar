/**
 * HCS-14 Universal Agent ID (https://hol.org/docs/standards/hcs-14/), "aid" target:
 *   uaid:aid:<base58(sha384(canonical json))>;uid=<agent id>;registry=chowkidaar;proto=x402;nativeId=hedera:<net>:<account>
 * The hash covers exactly registry, name, version, protocol, nativeId and skills, so the id is
 * deterministic and verifiable by anyone who knows the agent's name and Hedera account.
 */
import { createHash } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(buf: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b !== 0) break; out = "1" + out; }
  return out;
}

export const REGISTRY = "chowkidaar";
export const PROTOCOL = "x402";
export const VERSION = "1.0.0";

export function agentUaid(a: { id: string; name: string; account: string; network: string }): string {
  const nativeId = `${a.network}:${a.account}`; // hedera:testnet:0.0.x (CAIP-10)
  const doc = { name: a.name.trim(), nativeId, protocol: PROTOCOL, registry: REGISTRY, skills: [] as number[], version: VERSION };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(doc).sort(([x], [y]) => (x < y ? -1 : 1))));
  const id = base58(createHash("sha384").update(canonical, "utf8").digest());
  return `uaid:aid:${id};uid=${a.id};registry=${REGISTRY};proto=${PROTOCOL};nativeId=${nativeId}`;
}

/** The HCS message that announces an agent's id. Same topic as the receipts, so one log holds identity and spending. */
export const registrationMessage = (a: { uaid: string; name: string; account: string }) =>
  ({ v: 1, type: "agent.register", standard: "hcs-14", uaid: a.uaid, agent: a.account, name: a.name, ts: Math.floor(Date.now() / 1000) });
