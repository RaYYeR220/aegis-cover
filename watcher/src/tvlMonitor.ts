import type { TvlSample, TvlSignal } from "./types.js";

/** Keep only samples within `windowSeconds` of the newest sample timestamp. */
export function pruneSamples(samples: TvlSample[], windowSeconds: number, nowMs: number): TvlSample[] {
  const cutoff = nowMs - windowSeconds * 1000;
  return samples.filter((s) => s.ts >= cutoff);
}

/** bps change of `value` relative to `from`; 0 when `from` is 0. */
function bps(from: bigint, value: bigint): number {
  if (from === 0n) return 0;
  // (value - from) / from * 10000, computed in integer bps
  return Number(((value - from) * 10000n) / from);
}

export function computeTvlSignal(samples: TvlSample[], windowSeconds: number): TvlSignal {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return { current: 0n, baseline: 0n, deltaBps: 0, largestDropBps: 0, windowSeconds, sampleCount };
  }

  const current = samples[sampleCount - 1]!.tvl;
  let baseline = samples[0]!.tvl;
  for (const s of samples) if (s.tvl > baseline) baseline = s.tvl;

  let largestDropBps = 0;
  for (let i = 1; i < sampleCount; i++) {
    const prev = samples[i - 1]!.tvl;
    const curr = samples[i]!.tvl;
    if (curr < prev) {
      const dropBps = -bps(prev, curr); // positive magnitude
      if (dropBps > largestDropBps) largestDropBps = dropBps;
    }
  }

  return {
    current,
    baseline,
    deltaBps: sampleCount < 2 ? 0 : bps(baseline, current),
    largestDropBps,
    windowSeconds,
    sampleCount,
  };
}
