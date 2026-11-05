// All amounts are integers in micro-USDC (6 decimals). Never floats.
export const MICRO = 1_000_000;

export function formatUsdc(micro: number | string | bigint | null | undefined): string {
  if (micro === null || micro === undefined) return "—";
  const value = BigInt(micro);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${fraction ? "." + fraction : ""} USDC`;
}

/** "0.10" -> 100000. Throws on more than 6 decimals or bad input. */
export function parseUsdc(input: string): number {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!m) throw new Error("bad_amount");
  return Number(m[1]) * MICRO + Number((m[2] ?? "").padEnd(6, "0"));
}

/** SDK/x402 format 0.0.1@1700000000.123456789 -> mirror format 0.0.1-1700000000-123456789 */
export const toMirrorTxId = (id: string) => {
  const [account, time] = id.split("@");
  return time ? `${account}-${time.replace(".", "-")}` : id;
};

export const hashscanTx = (id: string, base = "https://hashscan.io/testnet") =>
  `${base}/transaction/${toMirrorTxId(id)}`;
export const hashscanAccount = (id: string, base = "https://hashscan.io/testnet") =>
  `${base}/account/${id}`;
export const hashscanTopic = (id: string, base = "https://hashscan.io/testnet") =>
  `${base}/topic/${id}`;
export const arkivEntityUrl = (key: string, base = "https://rabdi.explorer.arkiv.network") =>
  `${base}/entity/${key}`;
