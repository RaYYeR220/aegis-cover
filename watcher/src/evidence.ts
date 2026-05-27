import { toHex, stringToBytes } from "viem";
import type { Address, Hex, TvlSample, TvlSignal } from "./types.js";

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Deterministic JSON: keys recursively sorted so identical data yields identical strings. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

export interface EvidenceInput {
  target: Address;
  signal: TvlSignal;
  samples: TvlSample[];
  web2Alerts: string[];
  observedAt: number;
}

export interface Evidence {
  json: string;
  bytes: Hex;
}

/**
 * Build a deterministic, multi-signal evidence packet for the consensus AI.
 * bigints are rendered as decimal strings (JSON can't carry bigint).
 */
export function buildEvidence(input: EvidenceInput): Evidence {
  const packet = {
    schema: "aegis-exploit-evidence/1",
    target: input.target,
    observedAt: input.observedAt,
    tvl: {
      before: input.signal.baseline.toString(),
      after: input.signal.current.toString(),
      deltaBps: input.signal.deltaBps,
      windowSeconds: input.signal.windowSeconds,
      samples: input.samples.map((s) => ({ ts: s.ts, tvl: s.tvl.toString() })),
    },
    signals: {
      largestDropBps: input.signal.largestDropBps,
      web2Alerts: input.web2Alerts,
    },
  };
  const json = stableStringify(packet);
  return { json, bytes: toHex(stringToBytes(json)) };
}

export interface DepegEvidenceInput {
  target: Address;
  /** current price in wei (1e18 == peg) */
  priceWei: bigint;
  pegWei: bigint;
  depegBandBps: number;
  samples: TvlSample[];
  observedAt: number;
}

/**
 * Build a deterministic depeg evidence packet for the consensus AI. Distinct schema from the
 * exploit packet so the (depeg) system prompt has the right shape: price vs peg, deviation, direction.
 */
export function buildDepegEvidence(input: DepegEvidenceInput): Evidence {
  const deviationBps =
    input.pegWei > 0n && input.priceWei < input.pegWei
      ? Number(((input.pegWei - input.priceWei) * 10000n) / input.pegWei)
      : 0;
  const packet = {
    schema: "aegis-depeg-evidence/1",
    target: input.target,
    observedAt: input.observedAt,
    price: {
      current: input.priceWei.toString(),
      peg: input.pegWei.toString(),
      deviationBps,
      direction: input.priceWei < input.pegWei ? "below" : "at-or-above",
      bandBps: input.depegBandBps,
      samples: input.samples.map((s) => ({ ts: s.ts, price: s.tvl.toString() })),
    },
  };
  const json = stableStringify(packet);
  return { json, bytes: toHex(stringToBytes(json)) };
}
