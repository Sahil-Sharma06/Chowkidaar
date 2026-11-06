// Integer micro-USDC maths. No floats anywhere.
const bps = (name: string, d: number) => Number(process.env[name] || d);

export const FEE_BPS = bps("FEE_BPS", 200);
export const PENALTY_BPS = bps("PENALTY_BPS", 2000);

export const feeFor = (price: number) => Math.floor((price * FEE_BPS) / 10_000);
export const penaltyFor = (price: number) => Math.floor((price * PENALTY_BPS) / 10_000);
export const totalFor = (price: number) => price + feeFor(price);
export const lockFor = (price: number) => price + penaltyFor(price);
export const minBondFor = (price: number) => 10 * lockFor(price);

export type FaultCase = "A" | "B" | "C";

export interface Outcome {
  refundToAgent: number;
  refundFrom: "vault" | "gateway" | null;
  slash: number;
  feeKept: boolean;
  countsForReputation: boolean;
  failure: boolean;
}

/** One row of the outcome table in backend.md section 6. */
export function outcomeFor(kind: "delivered" | FaultCase, price: number): Outcome {
  switch (kind) {
    case "delivered":
      return { refundToAgent: 0, refundFrom: null, slash: 0, feeKept: true, countsForReputation: true, failure: false };
    case "A":
      return { refundToAgent: price, refundFrom: "vault", slash: lockFor(price), feeKept: true, countsForReputation: true, failure: true };
    case "B":
      return { refundToAgent: price, refundFrom: "gateway", slash: 0, feeKept: true, countsForReputation: true, failure: true };
    case "C":
      return { refundToAgent: totalFor(price), refundFrom: "gateway", slash: 0, feeKept: false, countsForReputation: false, failure: false };
  }
}

/** score = round(100 * ok / total), null until 5 calls. */
export function scoreFor(totalCalls: number, failedCalls: number): number | null {
  if (totalCalls < 5) return null;
  return Math.round((100 * (totalCalls - failedCalls)) / totalCalls);
}

/**
 * Ranking score (0-100) used to choose between merchants, not shown as the public score.
 * Every merchant starts as if it had RANK_PRIOR_OK good calls out of RANK_PRIOR_TOTAL (80),
 * so a brand-new bonded merchant is neither ignored (a flat 50) nor trusted like a proven one,
 * one lucky call does not jump to 100, and real calls quickly outweigh the prior.
 */
export const RANK_PRIOR_OK = 4;
export const RANK_PRIOR_TOTAL = 5;
export function rankFor(totalCalls: number, failedCalls: number): number {
  return Math.round((100 * (totalCalls - failedCalls + RANK_PRIOR_OK)) / (totalCalls + RANK_PRIOR_TOTAL));
}
