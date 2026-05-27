import { stringToHex } from "viem";
import { ADDR } from "./config";
import { publicClient } from "./config";
import { mockVaultAbi } from "./abi";

export interface RiskFactsInput {
  target: string;
  ageDays?: number;
  adminControlled?: boolean;
  priorIncident?: boolean;
  audited?: boolean;
}

/** Build canonical JSON bytes for requestRiskAssessment. */
export async function buildRiskFacts(input: RiskFactsInput): Promise<`0x${string}`> {
  let tvlStr = "unknown";
  try {
    const tvl = await publicClient.readContract({ address: ADDR.vault, abi: mockVaultAbi, functionName: "tvl" });
    tvlStr = tvl.toString();
  } catch { /* ignore */ }
  const obj = {
    schema: "aegis-risk-facts/1",
    target: input.target.toLowerCase(),
    ageDays: input.ageDays ?? 90,
    adminControlled: input.adminControlled ?? true,
    audited: input.audited ?? false,
    priorIncident: input.priorIncident ?? true,
    tvl: tvlStr,
  };
  return stringToHex(canonicalJSON(obj));
}

export interface ExploitEvidenceInput {
  target: string; observedAt: number;
  tvlBefore: bigint; tvlAfter: bigint; windowSeconds: number;
  samples?: { ts: number; tvl: bigint }[];
  web2Alerts?: string[];
}

// Build the canonical evidence packet (sorted keys, bigints as decimal strings) and hex-encode.
export function buildExploitEvidence(i: ExploitEvidenceInput): `0x${string}` {
  const before = i.tvlBefore, after = i.tvlAfter;
  const deltaBps = before === 0n ? 0 : Number(((after - before) * 10000n) / before);
  const obj = {
    schema: "aegis-exploit-evidence/1",
    target: i.target.toLowerCase(),
    observedAt: i.observedAt,
    tvl: {
      before: before.toString(), after: after.toString(), deltaBps,
      windowSeconds: i.windowSeconds,
      samples: (i.samples ?? []).map((s) => ({ ts: s.ts, tvl: s.tvl.toString() })),
    },
    signals: {
      largestDropBps: deltaBps < 0 ? deltaBps : 0,
      web2Alerts: i.web2Alerts ?? [],
    },
  };
  return stringToHex(canonicalJSON(obj));
}

export interface DepegEvidenceInput {
  target: string; observedAt: number;
  priceWei: bigint; pegWei: bigint; depegBandBps: number;
}

// Depeg evidence packet (matches the watcher's aegis-depeg-evidence/1). Used by the owner manual
// fallback; the watcher builds the same shape autonomously in price-mode.
export function buildDepegEvidence(i: DepegEvidenceInput): `0x${string}` {
  const deviationBps = i.pegWei > 0n && i.priceWei < i.pegWei
    ? Number(((i.pegWei - i.priceWei) * 10000n) / i.pegWei)
    : 0;
  const obj = {
    schema: "aegis-depeg-evidence/1",
    target: i.target.toLowerCase(),
    observedAt: i.observedAt,
    price: {
      current: i.priceWei.toString(),
      peg: i.pegWei.toString(),
      deviationBps,
      direction: i.priceWei < i.pegWei ? "below" : "at-or-above",
      bandBps: i.depegBandBps,
      samples: [] as { ts: number; price: string }[],
    },
  };
  return stringToHex(canonicalJSON(obj));
}

// Deterministic JSON: object keys sorted recursively.
export function canonicalJSON(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
