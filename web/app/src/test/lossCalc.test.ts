import { describe, it, expect } from "vitest";
import { computeLoss } from "../chain/lossCalc";

describe("computeLoss", () => {
  const C = 9000n, BPS = 10000n;
  it("full drain pays coinsured loss capped by sumInsured", () => {
    // pos before 0.1, after 0, sum 0.1 -> loss 0.1, covered 0.1, net 0.09
    const r = computeLoss(10n**17n, 0n, 10n**17n, C, BPS);
    expect(r).toEqual({ loss: 10n**17n, covered: 10n**17n, cap: 10n**17n, net: 9n*10n**16n });
  });
  it("partial loss capped by actual loss", () => {
    const r = computeLoss(10n**17n, 5n*10n**16n, 10n**17n, C, BPS); // loss 0.05
    expect(r.net).toBe(45n * 10n**15n); // 0.045
  });
  it("covered cannot exceed sumInsured", () => {
    const r = computeLoss(10n**18n, 0n, 10n**17n, C, BPS); // loss 1.0 but sum 0.1
    expect(r.covered).toBe(10n**17n);
    expect(r.net).toBe(9n * 10n**16n);
  });
});
