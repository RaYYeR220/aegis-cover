import { toHex, stringToBytes } from "viem";
import type { Address, Hex } from "./types.js";
import { stableStringify } from "./evidence.js";

export interface RiskFactsInput {
  target: Address;
  tvlWei: bigint;
  audited: boolean;
  ageDays: number;
  adminControlled: boolean;
  priorIncident: boolean;
}

export interface RiskFacts {
  json: string;
  bytes: Hex;
}

/**
 * Present-tense factual risk packet for the agent risk-pricing prompt (schema
 * `aegis-risk-facts/1`). Deterministic (recursively key-sorted); bigints as decimal strings.
 * The AegisCover oracle embeds this into the RISK_SYSTEM prompt; the agent committee scores
 * 0..100 and the median is cached on-chain (riskScore/riskAssessedAt).
 */
export function buildRiskFacts(i: RiskFactsInput): RiskFacts {
  const packet = {
    schema: "aegis-risk-facts/1",
    target: i.target,
    tvl: i.tvlWei.toString(),
    audited: i.audited,
    ageDays: i.ageDays,
    adminControlled: i.adminControlled,
    priorIncident: i.priorIncident,
  };
  const json = stableStringify(packet);
  return { json, bytes: toHex(stringToBytes(json)) };
}
