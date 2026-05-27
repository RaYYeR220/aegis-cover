export interface AssessDecisionInput {
  /** on-chain AegisCover.riskAssessedAt(target) in unix seconds (0 = never assessed) */
  lastAssessedAtSec: bigint;
  /** in-process: epoch ms when this watcher last fired an assessment for the target (0 = never) */
  lastFiredMs: number;
  nowMs: number;
  /** refresh cadence — the cached score is "stale" once it's older than this */
  intervalMs: number;
  /** in-process throttle so we don't re-fire while a verdict is still pending (~1–2 min) */
  minGapMs: number;
}

export interface AssessDecision {
  fire: boolean;
  reason: "never-assessed" | "stale" | "fresh" | "min-gap";
}

/**
 * Decide whether the periodic keeper should fire a fresh risk assessment for a target.
 * Pure — the loop supplies the on-chain `riskAssessedAt` and the in-process last-fire time.
 */
export function shouldAssess(i: AssessDecisionInput): AssessDecision {
  if (i.lastFiredMs > 0 && i.nowMs - i.lastFiredMs < i.minGapMs) {
    return { fire: false, reason: "min-gap" };
  }
  if (i.lastAssessedAtSec === 0n) {
    return { fire: true, reason: "never-assessed" };
  }
  const assessedMs = Number(i.lastAssessedAtSec) * 1000;
  if (i.nowMs - assessedMs >= i.intervalMs) {
    return { fire: true, reason: "stale" };
  }
  return { fire: false, reason: "fresh" };
}
