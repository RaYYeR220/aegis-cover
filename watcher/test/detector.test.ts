import { describe, it, expect } from "vitest";
import { evaluate, evaluateDepeg } from "../src/detector.js";
import type { TvlSignal } from "../src/types.js";

const PEG = 10n ** 18n;
const atBps = (bpsBelow: bigint) => (PEG * (10000n - bpsBelow)) / 10000n;

const signal = (over: Partial<TvlSignal>): TvlSignal => ({
  current: 0n,
  baseline: 0n,
  deltaBps: 0,
  largestDropBps: 0,
  windowSeconds: 120,
  sampleCount: 3,
  ...over,
});

describe("evaluate", () => {
  it("is not a candidate without enough samples", () => {
    const r = evaluate(signal({ sampleCount: 1, deltaBps: -9000 }), { dropThresholdBps: 3000 });
    expect(r.candidate).toBe(false);
  });

  it("is not a candidate for a small dip", () => {
    const r = evaluate(signal({ deltaBps: -1000 }), { dropThresholdBps: 3000 });
    expect(r.candidate).toBe(false);
    expect(r.severityScore).toBeLessThan(50);
  });

  it("flags a candidate when the drop crosses the threshold", () => {
    const r = evaluate(signal({ deltaBps: -4000, largestDropBps: 4000 }), { dropThresholdBps: 3000 });
    expect(r.candidate).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/TVL/);
    expect(r.severityScore).toBeGreaterThanOrEqual(50);
  });

  it("caps severityScore at 100 for an extreme drop", () => {
    const r = evaluate(signal({ deltaBps: -10000, largestDropBps: 10000 }), { dropThresholdBps: 3000 });
    expect(r.candidate).toBe(true);
    expect(r.severityScore).toBe(100);
  });
});

describe("evaluateDepeg", () => {
  it("is not a candidate at peg", () => {
    const r = evaluateDepeg(PEG, { pegWei: PEG, depegBandBps: 200 });
    expect(r.candidate).toBe(false);
  });

  it("is not a candidate for a wobble inside the band", () => {
    const r = evaluateDepeg(atBps(100n), { pegWei: PEG, depegBandBps: 200 }); // 1% below, band 2%
    expect(r.candidate).toBe(false);
    expect(r.severityScore).toBeLessThan(50);
  });

  it("flags a candidate when price falls below the band", () => {
    const r = evaluateDepeg(atBps(1000n), { pegWei: PEG, depegBandBps: 200 }); // 10% below
    expect(r.candidate).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/peg/i);
    expect(r.severityScore).toBeGreaterThanOrEqual(50);
  });

  it("does not flag a price at or above peg", () => {
    const r = evaluateDepeg((PEG * 10100n) / 10000n, { pegWei: PEG, depegBandBps: 200 }); // 1% above
    expect(r.candidate).toBe(false);
  });
});
