import { describe, expect, it } from "vitest";
import { feeFor, lockFor, minBondFor, outcomeFor, penaltyFor, scoreFor, totalFor } from "../src/money.ts";

const PRICE = 100_000; // 0.10 USDC

describe("money", () => {
  it("worked example from backend.md section 6", () => {
    expect(feeFor(PRICE)).toBe(2_000);
    expect(totalFor(PRICE)).toBe(102_000);
    expect(penaltyFor(PRICE)).toBe(20_000);
    expect(lockFor(PRICE)).toBe(120_000);
    expect(minBondFor(PRICE)).toBe(1_200_000);
  });

  it("outcome table rows", () => {
    expect(outcomeFor("delivered", PRICE)).toMatchObject({ refundToAgent: 0, slash: 0, feeKept: true, failure: false, countsForReputation: true });
    expect(outcomeFor("A", PRICE)).toMatchObject({ refundToAgent: PRICE, refundFrom: "vault", slash: 120_000, feeKept: true, failure: true });
    expect(outcomeFor("B", PRICE)).toMatchObject({ refundToAgent: PRICE, refundFrom: "gateway", slash: 0, feeKept: true, failure: true });
    expect(outcomeFor("C", PRICE)).toMatchObject({ refundToAgent: 102_000, refundFrom: "gateway", slash: 0, feeKept: false, countsForReputation: false });
  });

  it("case A nets out with no rounding gain or loss", () => {
    const out = outcomeFor("A", PRICE);
    const agent = -feeFor(PRICE);                 // paid price+fee, got price back
    const merchantWallet = PRICE;
    const bond = -out.slash;
    const gateway = totalFor(PRICE) - PRICE + (out.slash - PRICE); // fee + penalty
    expect(agent).toBe(-2_000);
    expect(merchantWallet).toBe(100_000);
    expect(bond).toBe(-120_000);
    expect(gateway).toBe(22_000);
    expect(agent + merchantWallet + bond + gateway).toBe(0);
  });

  it("integer maths for odd prices", () => {
    expect(feeFor(1)).toBe(0);
    expect(feeFor(49)).toBe(0);
    expect(feeFor(50)).toBe(1);
    expect(Number.isInteger(penaltyFor(123_457))).toBe(true);
  });

  it("score is null until 5 calls", () => {
    expect(scoreFor(4, 0)).toBeNull();
    expect(scoreFor(5, 0)).toBe(100);
    expect(scoreFor(10, 3)).toBe(70);
    expect(scoreFor(3, 3)).toBeNull();
  });
});
