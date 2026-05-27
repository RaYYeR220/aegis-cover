import type { DepegThresholds, DetectorResult, DetectorThresholds, TvlSignal } from "./types.js";

const BPS = 10_000;

/**
 * Cheap heuristic: is this drop worth asking the on-chain consensus AI about?
 * This does NOT decide the verdict — it only decides whether to open a check.
 * severityScore is for logging/telemetry, not the on-chain payout.
 */
export function evaluate(signal: TvlSignal, thresholds: DetectorThresholds): DetectorResult {
  const reasons: string[] = [];

  if (signal.sampleCount < 2) {
    return { candidate: false, reasons: ["insufficient-samples"], severityScore: 0 };
  }

  const dropBps = -signal.deltaBps; // positive when TVL fell below the peak
  const crossed = dropBps >= thresholds.dropThresholdBps;

  if (crossed) {
    reasons.push(`TVL fell ${(dropBps / 100).toFixed(1)}% from the in-window peak`);
    if (signal.largestDropBps >= thresholds.dropThresholdBps) {
      reasons.push(`largest single drop ${(signal.largestDropBps / 100).toFixed(1)}% (sudden drain pattern)`);
    }
  }

  // Severity: scale the drop between the threshold and a full 100% drain to 50..100.
  let severityScore = 0;
  if (dropBps > 0) {
    if (dropBps < thresholds.dropThresholdBps) {
      severityScore = Math.round((dropBps / thresholds.dropThresholdBps) * 50);
    } else {
      const span = 10000 - thresholds.dropThresholdBps;
      const over = Math.min(dropBps - thresholds.dropThresholdBps, span);
      severityScore = 50 + (span === 0 ? 50 : Math.round((over / span) * 50));
    }
  }
  severityScore = Math.max(0, Math.min(100, severityScore));

  return { candidate: crossed, reasons: reasons.length ? reasons : ["no-candidate"], severityScore };
}

/**
 * Depeg heuristic: is the current price far enough below peg to ask consensus about?
 * A depeg is a small, SUSTAINED deviation below peg — distinct from a TVL crash. Fires when
 * price <= peg*(BPS-band)/BPS. Like evaluate(), severityScore is for logging, not the verdict.
 */
export function evaluateDepeg(priceWei: bigint, t: DepegThresholds): DetectorResult {
  if (t.pegWei <= 0n) {
    return { candidate: false, reasons: ["no-peg"], severityScore: 0 };
  }
  const threshold = (t.pegWei * BigInt(BPS - t.depegBandBps)) / BigInt(BPS);
  const candidate = priceWei <= threshold;
  // deviation below peg in bps (0 when at/above peg)
  const deviationBps = priceWei >= t.pegWei ? 0 : Number(((t.pegWei - priceWei) * BigInt(BPS)) / t.pegWei);

  const reasons: string[] = [];
  if (candidate) {
    reasons.push(`price ${(deviationBps / 100).toFixed(2)}% below peg (band ${(t.depegBandBps / 100).toFixed(2)}%)`);
  }

  // Severity: scale the deviation between the band and a full 100% depeg to 50..100.
  let severityScore = 0;
  if (deviationBps > 0) {
    if (deviationBps < t.depegBandBps) {
      severityScore = Math.round((deviationBps / t.depegBandBps) * 50);
    } else {
      const span = BPS - t.depegBandBps;
      const over = Math.min(deviationBps - t.depegBandBps, span);
      severityScore = 50 + (span === 0 ? 50 : Math.round((over / span) * 50));
    }
  }
  severityScore = Math.max(0, Math.min(100, severityScore));

  return { candidate, reasons: reasons.length ? reasons : ["at-peg"], severityScore };
}
