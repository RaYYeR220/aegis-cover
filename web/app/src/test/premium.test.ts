import { describe, it, expect } from "vitest";
import { quotePremiumLocal } from "../chain/premium";

describe("quotePremiumLocal mirrors AegisCover.quotePremium", () => {
  const YEAR = 365n * 86400n, BPS = 10000n;
  it("0.1 STT @ 10% for 365d = 0.01 STT", () => {
    expect(quotePremiumLocal(10n**17n, 1000n, YEAR, BPS, YEAR)).toBe(10n**16n);
  });
  it("scales with duration (90d ≈ quarter)", () => {
    const p = quotePremiumLocal(10n**17n, 1000n, 90n*86400n, BPS, YEAR);
    expect(p).toBe(10n**17n * 1000n * (90n*86400n) / (BPS * YEAR));
  });
});
