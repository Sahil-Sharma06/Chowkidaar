import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { createMerchantSchema, depositSchema, patchMerchantSchema, withdrawSchema } from "@app/shared";
import type { Db } from "../db/index.ts";
import { schema } from "../db/index.ts";
import { env } from "../env.ts";
import { newId } from "../ids.ts";
import { consumeStepUp, requireRole, stepUpRequired, type Session } from "../auth.ts";
import { compileSchema } from "../checks.ts";
import { lockFor, minBondFor, totalFor } from "../money.ts";
import { assertSafeUrl } from "../ssrf.ts";
import { buildReceipt } from "../receipt.ts";
import { toPublicMerchant } from "./public.ts";

const { merchants, bondLedger, payments } = schema;
type Vars = { Variables: { session: Session } };

export function bondView(m: typeof merchants.$inferSelect) {
  const available = m.bondBalance - m.bondLocked;
  const perFailure = lockFor(m.price);
  return {
    vaultAccount: env.vaultId, token: env.usdc, memo: `bond:${m.id}`,
    balance: String(m.bondBalance), locked: String(m.bondLocked), available: String(available),
    minimum: String(minBondFor(m.price)), perFailure: String(perFailure),
    failuresCovered: perFailure > 0 ? Math.floor(available / perFailure) : 0,
    covered: available >= perFailure,
  };
}

export type BondWithdraw = (o: { merchantId: string; to: string; amount: number }) => Promise<{ txId: string }>;
const liveWithdraw: BondWithdraw = async (o) => (await import("../chain/hedera.ts")).withdrawFromBond(o);

export function merchantRoutes(db: Db, withdraw: BondWithdraw = liveWithdraw) {
  const app = new Hono<Vars>();
  for (const p of ["/merchants", "/merchants/*"]) app.use(p, requireRole(db, "merchant"));

  const mine = (c: { get(k: "session"): Session }) =>
    db.select().from(merchants).where(eq(merchants.accountId, c.get("session").sub)).get();

  const full = (m: typeof merchants.$inferSelect) => ({ ...m, bond: bondView(m), public: toPublicMerchant(m), total: String(totalFor(m.price)) });

  app.get("/merchants/me", (c) => {
    const m = mine(c);
    return m ? c.json(full(m)) : c.json({ error: "not_found" }, 404);
  });

  app.post("/merchants", zValidator("json", createMerchantSchema), async (c) => {
    if (mine(c)) return c.json({ error: "already_registered" }, 409);
    const body = c.req.valid("json");
    try { compileSchema("new", body.responseSchema); } catch (err) { return c.json({ error: "bad_schema", detail: String(err) }, 400); }
    try { await assertSafeUrl(body.endpointUrl, env.demoMode); } catch (err) { return c.json({ error: String((err as Error).message) }, 400); }
    const id = newId("mer");
    try {
      db.insert(merchants).values({ id, accountId: c.get("session").sub, status: "testing", ...body }).run();
    } catch (err) {
      return c.json({ error: "slug_taken", detail: String(err) }, 409);
    }
    return c.json(full(db.select().from(merchants).where(eq(merchants.id, id)).get()!), 201);
  });

  app.patch("/merchants/:id", zValidator("json", patchMerchantSchema), async (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    if (m.status === "suspended") return c.json({ error: "suspended" }, 403);
    const { status, ...patch } = c.req.valid("json");
    if (patch.responseSchema) { try { compileSchema(m.id, patch.responseSchema); } catch (err) { return c.json({ error: "bad_schema", detail: String(err) }, 400); } }
    if (patch.endpointUrl) { try { await assertSafeUrl(patch.endpointUrl, env.demoMode); } catch (err) { return c.json({ error: String((err as Error).message) }, 400); } }

    let nextStatus = m.status;
    const configChanged = Object.keys(patch).length > 0;
    if (configChanged) nextStatus = "testing"; // edits must be re-tested
    if (status === "paused" && m.status === "live") nextStatus = "paused";
    if (status === "live" && (m.status === "paused" || m.status === "needs_bond")) {
      const merged = { ...m, ...patch };
      nextStatus = merged.bondBalance - merged.bondLocked >= minBondFor(merged.price) ? "live" : "needs_bond";
    }
    db.update(merchants).set({ ...patch, status: nextStatus }).where(eq(merchants.id, m.id)).run();
    return c.json(full(db.select().from(merchants).where(eq(merchants.id, m.id)).get()!));
  });

  /** Unpaid reachability test: the endpoint must answer 402 with the registered payout, asset and price. */
  app.post("/merchants/:id/test", async (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    const checks = { reachable: false, returns402: false, payoutMatches: false, assetMatches: false, priceMatches: false };
    let detail: string | null = null;
    try {
      const res = await fetch(m.endpointUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", redirect: "error", signal: AbortSignal.timeout(8000) });
      checks.reachable = true;
      checks.returns402 = res.status === 402;
      let required: { accepts?: { payTo: string; asset: string; amount: string }[] } | null = null;
      const header = res.headers.get("payment-required");
      if (header) { try { required = JSON.parse(Buffer.from(header, "base64").toString("utf8")); } catch { /* ignore */ } }
      if (!required) { try { required = await res.json(); } catch { /* ignore */ } }
      const opt = required?.accepts?.[0];
      if (opt) {
        checks.payoutMatches = opt.payTo === m.payoutAccountId;
        checks.assetMatches = opt.asset === env.usdc;
        checks.priceMatches = BigInt(opt.amount) <= BigInt(m.price);
      }
    } catch (err) {
      detail = String((err as Error).message ?? err);
    }
    const passed = Object.values(checks).every(Boolean);
    if (passed && (m.status === "testing" || m.status === "draft")) {
      const next = m.bondBalance - m.bondLocked >= minBondFor(m.price) ? "live" : "needs_bond";
      db.update(merchants).set({ status: next }).where(eq(merchants.id, m.id)).run();
    }
    return c.json({ passed, checks, detail, merchant: full(db.select().from(merchants).where(eq(merchants.id, m.id)).get()!) });
  });

  app.get("/merchants/:id/bond", (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    const ledger = db.select().from(bondLedger).where(eq(bondLedger.merchantId, m.id)).orderBy(desc(bondLedger.createdAt)).all();
    return c.json({ ...bondView(m), ledger });
  });

  app.post("/merchants/:id/bond/deposits", zValidator("json", depositSchema), async (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    const { txId } = c.req.valid("json");
    const { verifyDeposit, DepositError } = await import("../chain/mirror.ts");
    let dep: { amount: number; txId: string };
    try {
      dep = await verifyDeposit(txId, m.id);
    } catch (err) {
      if (err instanceof DepositError) return c.json({ error: err.code }, 400);
      return c.json({ error: "not_found_yet", detail: String(err) }, 400);
    }
    try {
      db.transaction((tx) => {
        tx.insert(bondLedger).values({ id: newId("led"), merchantId: m.id, type: "deposit", amount: dep.amount, txId: dep.txId }).run();
        const balance = m.bondBalance + dep.amount;
        const status = m.status === "needs_bond" && balance - m.bondLocked >= minBondFor(m.price) ? "live"
          : m.status === "paused" && balance - m.bondLocked >= lockFor(m.price) ? "live" : m.status;
        tx.update(merchants).set({ bondBalance: balance, status }).where(eq(merchants.id, m.id)).run();
      });
    } catch {
      return c.json({ error: "duplicate" }, 409);
    }
    const fresh = db.select().from(merchants).where(eq(merchants.id, m.id)).get()!;
    return c.json({ credited: String(dep.amount), ...bondView(fresh), merchant: full(fresh) });
  });

  /**
   * Withdraw the unreserved part of the bond to the merchant's payout account.
   * Needs a fresh World ID step-up. The amount is reserved in the database before the transfer,
   * so two concurrent withdrawals can never both spend it; a failed transfer releases it again.
   */
  app.post("/merchants/:id/bond/withdraw", zValidator("json", withdrawSchema), async (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    if (m.status === "suspended") return c.json({ error: "suspended" }, 403);
    const { amount } = c.req.valid("json");
    if (amount > m.bondBalance - m.bondLocked) return c.json({ error: "insufficient_available", available: String(m.bondBalance - m.bondLocked) }, 400);
    const scope = `merchant:${m.id}:withdraw`;
    if (!consumeStepUp(db, c.get("session"), scope)) return stepUpRequired(c, scope);

    const ledgerId = newId("led");
    const reserved = db.transaction((tx) => {
      const cur = tx.select().from(merchants).where(eq(merchants.id, m.id)).get()!;
      if (amount > cur.bondBalance - cur.bondLocked) return false;
      tx.update(merchants).set({ bondBalance: cur.bondBalance - amount }).where(eq(merchants.id, m.id)).run();
      tx.insert(bondLedger).values({ id: ledgerId, merchantId: m.id, type: "withdraw", amount }).run();
      return true;
    });
    if (!reserved) return c.json({ error: "insufficient_available" }, 400);

    let txId: string;
    try {
      txId = (await withdraw({ merchantId: m.id, to: m.payoutAccountId, amount })).txId;
    } catch (err) {
      db.transaction((tx) => {
        const cur = tx.select().from(merchants).where(eq(merchants.id, m.id)).get()!;
        tx.update(merchants).set({ bondBalance: cur.bondBalance + amount }).where(eq(merchants.id, m.id)).run();
        tx.delete(bondLedger).where(eq(bondLedger.id, ledgerId)).run();
      });
      console.error("[withdraw] transfer failed:", err);
      return c.json({ error: "transfer_failed", detail: env.demoMode ? String((err as Error).message ?? err) : undefined }, 502);
    }

    db.transaction((tx) => {
      tx.update(bondLedger).set({ txId }).where(eq(bondLedger.id, ledgerId)).run();
      const cur = tx.select().from(merchants).where(eq(merchants.id, m.id)).get()!;
      // A live merchant whose bond falls below the minimum stops taking calls until it tops up.
      if (cur.status === "live" && cur.bondBalance - cur.bondLocked < minBondFor(cur.price)) {
        tx.update(merchants).set({ status: "needs_bond" }).where(eq(merchants.id, m.id)).run();
      }
    });
    const fresh = db.select().from(merchants).where(eq(merchants.id, m.id)).get()!;
    return c.json({ withdrawn: String(amount), txId, ...bondView(fresh), merchant: full(fresh) });
  });

  app.get("/merchants/:id/payments", (c) => {
    const m = mine(c);
    if (!m || m.id !== c.req.param("id")) return c.json({ error: "not_found" }, 404);
    const rows = db.select({ id: payments.id }).from(payments).where(eq(payments.merchantId, m.id)).orderBy(desc(payments.createdAt)).limit(100).all();
    return c.json(rows.map((r) => buildReceipt(db, r.id)));
  });

  return app;
}
