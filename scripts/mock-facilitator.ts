/**
 * Local mock x402 facilitator for running the whole stack without funded accounts.
 * It "settles" anything it is handed and reports the payer from the payload's
 * transaction id account. Money never moves. For development only.
 *
 *   node --import tsx scripts/mock-facilitator.ts        (port 4500)
 *   FACILITATOR_URL=http://localhost:4500 npm run dev:backend
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { inspectHederaTransaction } from "@x402/hedera";

const port = Number(process.env.MOCK_FACILITATOR_PORT || 4500);
const FEE_PAYER = "0.0.9185802";
let n = 0;

function payerOf(payload: { payload?: { transaction?: string } }): string {
  try {
    const t = inspectHederaTransaction(String(payload.payload?.transaction));
    // the account that is a net sender of the token
    for (const list of Object.values(t.tokenTransfers)) for (const e of list) if (BigInt(e.amount) < 0n) return e.accountId;
    for (const e of t.hbarTransfers) if (BigInt(e.amount) < 0n && e.accountId !== FEE_PAYER) return e.accountId;
  } catch { /* unparseable payload in tests */ }
  return "0.0.0";
}

const app = new Hono();
app.get("/supported", (c) => c.json({
  kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: FEE_PAYER } }],
  extensions: [], signers: { "hedera:*": [FEE_PAYER] },
}));
app.post("/verify", async (c) => {
  const { paymentPayload } = (await c.req.json()) as { paymentPayload: { payload?: { transaction?: string } } };
  return c.json({ isValid: true, payer: payerOf(paymentPayload) });
});
app.post("/settle", async (c) => {
  const { paymentPayload, paymentRequirements } = (await c.req.json()) as { paymentPayload: { payload?: { transaction?: string } }; paymentRequirements: { amount: string } };
  const transaction = `${FEE_PAYER}@${Math.floor(Date.now() / 1000)}.${String(++n).padStart(9, "0")}`;
  console.log(`[mock-facilitator] settle ${paymentRequirements.amount} from ${payerOf(paymentPayload)} -> ${transaction}`);
  return c.json({ success: true, transaction, network: "hedera:testnet", payer: payerOf(paymentPayload), amount: paymentRequirements.amount });
});

serve({ fetch: app.fetch, port }, () => console.log(`mock facilitator on http://localhost:${port} (NO MONEY MOVES)`));
