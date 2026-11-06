import { describe, expect, it } from "vitest";
import { pick, type Candidate } from "../src/ask.ts";
import { rankFor } from "../src/money.ts";

const c = (slug: string, calls: number, rank: number, extra: Partial<Candidate> = {}): Candidate => ({
  id: slug, slug, name: slug, category: "food", price: "10000", total: "10200",
  score: null, rank, calls, matched: ["burger"], eligible: true, why: [], ...extra,
});

describe("rankFor", () => {
  it("starts a new merchant at 80, not 50 and not 100", () => expect(rankFor(0, 0)).toBe(80));
  it("does not let one lucky call jump to 100", () => expect(rankFor(1, 0)).toBe(83));
  it("drops quickly on failures", () => expect(rankFor(2, 2)).toBe(57));
  it("lets a long record outweigh the prior", () => expect(rankFor(100, 2)).toBe(97));
});

describe("pick", () => {
  const proven = c("proven", 50, 96);
  const fresh = c("fresh", 0, 80);

  it("picks the best-ranked merchant most of the time", () => expect(pick([proven, fresh], () => 0.9)?.slug).toBe("proven"));
  it("sometimes tries a bonded newcomer", () => expect(pick([proven, fresh], () => 0.01)?.slug).toBe("fresh"));
  it("never explores into an ineligible newcomer", () =>
    expect(pick([proven, c("blocked", 0, 80, { eligible: false })], () => 0.01)?.slug).toBe("proven"));
  it("never explores into a weaker match", () =>
    expect(pick([c("exact", 50, 96, { matched: ["burger", "fries"] }), fresh], () => 0.01)?.slug).toBe("exact"));
  it("returns nothing when no one is eligible", () => expect(pick([c("x", 0, 80, { eligible: false })])).toBeUndefined());
});
