export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface TvlSample {
  /** epoch milliseconds */
  ts: number;
  /** observed value in wei — TVL (native balance) for tvl targets, price for price targets */
  tvl: bigint;
}

/** What value the watcher observes for a target, and how it decides a check is warranted. */
export type TargetKind = "tvl" | "price";

export interface DepegThresholds {
  /** peg price in wei (1e18 == 1.0) */
  pegWei: bigint;
  /** how far below peg (bps) counts as a depeg, e.g. 200 = 2% */
  depegBandBps: number;
}

export interface TvlSignal {
  current: bigint;
  /** highest TVL observed in the window (the peak we measure the drop from) */
  baseline: bigint;
  /** (current - baseline) / baseline in basis points; <= 0 for a drop; 0 if no baseline */
  deltaBps: number;
  /** largest single drop between consecutive in-window samples, in bps (>= 0) */
  largestDropBps: number;
  windowSeconds: number;
  sampleCount: number;
}

export interface DetectorThresholds {
  dropThresholdBps: number;
}

export interface DetectorResult {
  candidate: boolean;
  reasons: string[];
  /** 0..100 heuristic severity, for logging only — NOT the on-chain verdict */
  severityScore: number;
}

export interface TargetConfig {
  address: Address;
  /** value source + detector: "tvl" (native-balance drop) or "price" (depeg below peg) */
  kind: TargetKind;
  /** TVL-drop threshold (bps) — used by tvl targets */
  dropThresholdBps: number;
  /** peg price in wei — required for price targets */
  pegWei?: bigint;
  /** depeg band (bps below peg) — required for price targets */
  depegBandBps?: number;
}

export interface WatcherConfig {
  rpcUrl: string;
  coverAddress: Address;
  privateKey?: Hex;
  pollIntervalMs: number;
  windowSeconds: number;
  cooldownMs: number;
  /** Periodic risk-keeper refresh cadence (ms). 0 = keeper disabled (never auto-spends STT). */
  riskAssessIntervalMs: number;
  /** In-process throttle so the keeper doesn't re-fire while a verdict is still pending (ms). */
  riskAssessMinGapMs: number;
  dryRun: boolean;
  targets: TargetConfig[];
}
