import type { Address, Hex, TargetConfig, TargetKind, TvlSample } from "./types.js";
import { pruneSamples, computeTvlSignal } from "./tvlMonitor.js";
import { evaluate, evaluateDepeg } from "./detector.js";
import { buildEvidence, buildDepegEvidence } from "./evidence.js";

export interface WatchDeps {
  /** Native balance of a target — the TVL signal AND the risk-keeper's facts source. */
  getTvl(target: Address): Promise<bigint>;
  /** Value the detector watches: balance for tvl targets, price() for price (depeg) targets. */
  getObservedValue(target: Address, kind: TargetKind): Promise<bigint>;
  isSettled(target: Address): Promise<boolean>;
  sendCheck(target: Address, evidence: Hex): Promise<Hex>;
  getAlerts(target: Address): Promise<string[]>;
  /** Periodic risk-keeper: read the on-chain cached-score timestamp (riskAssessedAt). */
  getRiskAssessedAt(target: Address): Promise<bigint>;
  /** Periodic risk-keeper: fire requestRiskAssessment(target, facts) (onlyOwner). */
  sendRiskAssessment(target: Address, facts: Hex): Promise<Hex>;
}

export interface TargetState {
  samples: TvlSample[];
  lastTriggeredMs: number;
}

export interface WatchCycleCfg {
  windowSeconds: number;
  cooldownMs: number;
}

export interface WatchAction {
  triggered: boolean;
  reason: string;
  txHash?: Hex;
  severityScore?: number;
  /** Observed value read this cycle (TVL for tvl targets, price for price targets) — for heartbeat. */
  observedWei?: bigint;
}

export async function runWatchCycle(
  target: TargetConfig,
  deps: WatchDeps,
  state: TargetState,
  cfg: WatchCycleCfg,
  nowMs: number,
): Promise<WatchAction> {
  if (await deps.isSettled(target.address)) {
    return { triggered: false, reason: "settled" };
  }

  const observed = await deps.getObservedValue(target.address, target.kind);
  state.samples.push({ ts: nowMs, tvl: observed });
  state.samples = pruneSamples(state.samples, cfg.windowSeconds, nowMs);

  const inCooldown = state.lastTriggeredMs > 0 && nowMs - state.lastTriggeredMs < cfg.cooldownMs;

  // ── Depeg path: price below the peg band ──
  if (target.kind === "price") {
    const pegWei = target.pegWei ?? 10n ** 18n;
    const depegBandBps = target.depegBandBps ?? 200;
    const result = evaluateDepeg(observed, { pegWei, depegBandBps });
    if (!result.candidate) {
      return { triggered: false, reason: result.reasons.join("; "), severityScore: result.severityScore, observedWei: observed };
    }
    if (inCooldown) {
      return { triggered: false, reason: "cooldown", severityScore: result.severityScore, observedWei: observed };
    }
    const evidence = buildDepegEvidence({
      target: target.address,
      priceWei: observed,
      pegWei,
      depegBandBps,
      samples: state.samples,
      observedAt: nowMs,
    });
    const txHash = await deps.sendCheck(target.address, evidence.bytes);
    state.lastTriggeredMs = nowMs;
    return { triggered: true, reason: result.reasons.join("; "), txHash, severityScore: result.severityScore, observedWei: observed };
  }

  // ── TVL path (default): native-balance drop ──
  const signal = computeTvlSignal(state.samples, cfg.windowSeconds);
  const result = evaluate(signal, { dropThresholdBps: target.dropThresholdBps });

  if (!result.candidate) {
    return { triggered: false, reason: result.reasons.join("; "), severityScore: result.severityScore, observedWei: observed };
  }
  if (inCooldown) {
    return { triggered: false, reason: "cooldown", severityScore: result.severityScore, observedWei: observed };
  }

  const web2Alerts = await deps.getAlerts(target.address);
  const evidence = buildEvidence({
    target: target.address,
    signal,
    samples: state.samples,
    web2Alerts,
    observedAt: nowMs,
  });

  const txHash = await deps.sendCheck(target.address, evidence.bytes);
  state.lastTriggeredMs = nowMs;
  return { triggered: true, reason: result.reasons.join("; "), txHash, severityScore: result.severityScore, observedWei: observed };
}
