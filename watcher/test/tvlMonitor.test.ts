import { describe, it, expect } from "vitest";
import { pruneSamples, computeTvlSignal } from "../src/tvlMonitor.js";
import type { TvlSample } from "../src/types.js";

const wei = (n: number) => BigInt(n) * 10n ** 18n;

describe("pruneSamples", () => {
  it("drops samples older than the window relative to the newest", () => {
    const samples: TvlSample[] = [
      { ts: 1_000, tvl: wei(5) },
      { ts: 100_000, tvl: wei(5) },
      { ts: 130_000, tvl: wei(0) },
    ];
    // window 120s = 120_000ms; newest ts 130_000 -> keep ts >= 10_000
    const kept = pruneSamples(samples, 120, 130_000);
    expect(kept.map((s) => s.ts)).toEqual([100_000, 130_000]);
  });
});

describe("computeTvlSignal", () => {
  it("returns zero delta with fewer than 2 samples", () => {
    const s = computeTvlSignal([{ ts: 0, tvl: wei(5) }], 120);
    expect(s.sampleCount).toBe(1);
    expect(s.deltaBps).toBe(0);
    expect(s.largestDropBps).toBe(0);
  });

  it("computes a 100% drop as -10000 bps from the peak", () => {
    const samples: TvlSample[] = [
      { ts: 0, tvl: wei(5) },
      { ts: 5_000, tvl: wei(5) },
      { ts: 10_000, tvl: wei(0) },
    ];
    const s = computeTvlSignal(samples, 120);
    expect(s.baseline).toBe(wei(5));
    expect(s.current).toBe(0n);
    expect(s.deltaBps).toBe(-10000);
    expect(s.largestDropBps).toBe(10000); // single 5->0 step
  });

  it("computes a partial drop in bps", () => {
    const samples: TvlSample[] = [
      { ts: 0, tvl: wei(100) },
      { ts: 5_000, tvl: wei(60) }, // -40% from peak
    ];
    const s = computeTvlSignal(samples, 120);
    expect(s.deltaBps).toBe(-4000);
    expect(s.largestDropBps).toBe(4000);
  });

  it("measures drop from the in-window peak, not the first sample", () => {
    const samples: TvlSample[] = [
      { ts: 0, tvl: wei(50) },
      { ts: 5_000, tvl: wei(100) }, // peak
      { ts: 10_000, tvl: wei(70) }, // -30% from peak
    ];
    const s = computeTvlSignal(samples, 120);
    expect(s.baseline).toBe(wei(100));
    expect(s.deltaBps).toBe(-3000);
  });
});
