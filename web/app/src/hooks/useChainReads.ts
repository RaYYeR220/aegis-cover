import { useEffect, useRef, useState } from "react";
import { keccak256, toBytes, formatUnits, type Address } from "viem";
import { publicClient, ADDR } from "../chain/config";
import { aegisCoverAbi, mockVaultAbi, mockStableAbi, oracleAbi, adapterAbi } from "../chain/abi";

// Peril keys = keccak256(NAME), matching ConsensusOracle.<NAME>_KEY. New perils are pure data
// (a prompt key added via setSystemPrompt), so the registry can list a target under any of these.
const PERIL_KEYS: Record<Exclude<PerilName, "Other">, string> = {
  Exploit: keccak256(toBytes("EXPLOIT")),
  Depeg: keccak256(toBytes("DEPEG")),
  Bridge: keccak256(toBytes("BRIDGE")),
  Slashing: keccak256(toBytes("SLASHING")),
  Oracle: keccak256(toBytes("ORACLE")),
  Governance: keccak256(toBytes("GOVERNANCE")),
};
// Price-observed perils watch a feed vs a reference; the rest watch native-balance TVL.
const PRICE_PERILS = new Set<PerilName>(["Depeg", "Oracle"]);

export type PerilName = "Exploit" | "Depeg" | "Bridge" | "Slashing" | "Oracle" | "Governance" | "Other";

/** A catalog entry read live from the cover registry — drives the registry marketplace cards. */
export interface Listing {
  target: Address;
  adapter: Address;     // position adapter (positionOf) for buy-flow coverage caps
  name: string;
  perilKey: string;
  peril: PerilName;
  isPrice: boolean;     // depeg targets are priced (price vs peg); else native-balance TVL
  active: boolean;
  observed: bigint;     // price (1e18 = peg) for price targets, native balance for tvl targets
  riskScore: bigint;
  riskAssessed: boolean;
  rateBps: bigint;
  riskAssessedAt: bigint; // when the AI keeper last priced this target (for "priced Nh ago")
  settled: boolean;
  samples: number[];    // per-target observed-value history (display units) for the card chart
}

export interface ChainState {
  tvl: bigint; tvlSamples: { ts: number; tvl: bigint }[];
  riskScore: bigint; riskAssessed: boolean; riskAssessedAt: bigint; rateBps: bigint;
  targetSettled: boolean;
  scoreThreshold: bigint; subcommitteeSize: bigint; minResponses: bigint;
  coinsuranceBps: bigint; bps: bigint; year: bigint;
  // wallet-scoped (null until account passed)
  claimable: bigint; position: bigint;
  // registry-driven marketplace (empty against the legacy core)
  listings: Listing[];
  loaded: boolean;
}

const READS_VAULT = ADDR.vault;
export function useChainReads(account: Address | null, intervalMs = 5000): ChainState {
  const [s, setS] = useState<ChainState>(() => empty());
  const samples = useRef<{ ts: number; tvl: bigint }[]>([]);
  const samplesByTarget = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const base = await publicClient.multicall({
          allowFailure: false,
          deployless: true, // Somnia Shannon has no deployed multicall3
          contracts: [
            { address: ADDR.vault, abi: mockVaultAbi, functionName: "tvl" },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskScore", args: [READS_VAULT] },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskAssessed", args: [READS_VAULT] },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskAssessedAt", args: [READS_VAULT] },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "targetSettled", args: [READS_VAULT] },
            { address: ADDR.oracle, abi: oracleAbi, functionName: "scoreThreshold" },
            { address: ADDR.oracle, abi: oracleAbi, functionName: "subcommitteeSize" },
            { address: ADDR.oracle, abi: oracleAbi, functionName: "minResponses" },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "COINSURANCE_BPS" },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "BPS" },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "YEAR" },
          ],
        });
        const [tvl, riskScore, riskAssessed, riskAssessedAt, targetSettled, scoreThreshold, subcommitteeSize, minResponses, coinsuranceBps, bps, year] = base as any[];
        // rateBps reverts if !riskAssessed — read separately, tolerate revert
        let rateBps = 0n;
        if (riskAssessed) {
          try { rateBps = (await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "rateBps", args: [READS_VAULT] })) as bigint; } catch { /* ignore */ }
        }
        let claimable = 0n, position = 0n;
        if (account) {
          const w = await publicClient.multicall({ allowFailure: true, deployless: true, contracts: [
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "claimable", args: [account] },
            { address: ADDR.adapter, abi: adapterAbi, functionName: "positionOf", args: [account] },
          ] });
          claimable = (w[0].status === "success" ? w[0].result : 0n) as bigint;
          position = (w[1].status === "success" ? w[1].result : 0n) as bigint;
        }
        // Registry-driven marketplace — tolerant: empty [] against the legacy core (no registry).
        const listings = await readListings();
        // Per-target observed-value history (display units) so EVERY card gets a live chart, not
        // just the vault. Seed a flat baseline on first sight; append only on change (cap 60).
        for (const l of listings) {
          const key = l.target.toLowerCase();
          const valNum = Number(formatUnits(l.observed, 18));
          let buf = samplesByTarget.current.get(key);
          if (!buf || buf.length === 0) buf = Array.from({ length: 16 }, () => valNum);
          else if (buf[buf.length - 1] !== valNum) buf = [...buf, valNum].slice(-60);
          samplesByTarget.current.set(key, buf);
          l.samples = buf;
        }
        // ring buffer (keep last 60 samples). Seed a flat baseline on the first sample so the
        // sparkline renders immediately — otherwise it only grows when TVL changes, leaving a
        // steady vault with an empty chart until the first move.
        const now = Date.now();
        if (!samples.current.length) {
          samples.current = Array.from({ length: 16 }, (_, i) => ({ ts: now - (15 - i) * intervalMs, tvl }));
        } else if (samples.current[samples.current.length - 1].tvl !== tvl) {
          samples.current = [...samples.current, { ts: now, tvl }].slice(-60);
        }
        if (alive) setS({ tvl, tvlSamples: samples.current, riskScore, riskAssessed, riskAssessedAt, rateBps, targetSettled, scoreThreshold, subcommitteeSize, minResponses, coinsuranceBps, bps, year, claimable, position, listings, loaded: true });
      } catch { /* keep last good state; transient RPC errors are fine */ }
    }
    tick();
    const h = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(h); };
  }, [account, intervalMs]);

  return s;
}

function empty(): ChainState {
  return { tvl: 0n, tvlSamples: [], riskScore: 0n, riskAssessed: false, riskAssessedAt: 0n, rateBps: 0n, targetSettled: false, scoreThreshold: 70n, subcommitteeSize: 5n, minResponses: 3n, coinsuranceBps: 9000n, bps: 10000n, year: 31536000n, claimable: 0n, position: 0n, listings: [], loaded: false };
}

function perilOf(perilKey: string): PerilName {
  const k = perilKey.toLowerCase();
  for (const [name, key] of Object.entries(PERIL_KEYS)) {
    if (k === key.toLowerCase()) return name as PerilName;
  }
  return "Other";
}

/**
 * Read the cover's catalog: listedTargetsCount → each listedTargets(i) → listing(target) plus its
 * live risk/settled/observed value. Fully tolerant — any revert (legacy core) yields []. The
 * registry only grows (re-armed targets append; superseded ones are deactivated, not removed), so we
 * scan every index and skip inactive entries — only active targets get the heavier per-target reads.
 */
async function readListings(): Promise<Listing[]> {
  try {
    const count = Number((await publicClient.readContract({
      address: ADDR.cover, abi: aegisCoverAbi, functionName: "listedTargetsCount",
    })) as bigint);
    const out: Listing[] = [];
    for (let i = 0; i < count && i < 64; i++) {
      const target = (await publicClient.readContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "listedTargets", args: [BigInt(i)],
      })) as Address;
      const l = (await publicClient.readContract({
        address: ADDR.cover, abi: aegisCoverAbi, functionName: "listing", args: [target],
      })) as readonly [Address, string, boolean, string];
      const [adapter, perilKey, active, name] = l;
      if (!active) continue; // superseded/retired targets — every consumer filters to active anyway
      const peril = perilOf(perilKey);
      const isPrice = PRICE_PERILS.has(peril);

      const r = await publicClient.multicall({
        allowFailure: true, deployless: true,
        contracts: [
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskScore", args: [target] },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskAssessed", args: [target] },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "targetSettled", args: [target] },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "riskAssessedAt", args: [target] },
        ],
      });
      const riskScore = (r[0].status === "success" ? r[0].result : 0n) as bigint;
      const riskAssessed = (r[1].status === "success" ? r[1].result : false) as boolean;
      const settled = (r[2].status === "success" ? r[2].result : false) as boolean;
      const riskAssessedAt = (r[3].status === "success" ? r[3].result : 0n) as bigint;

      let rateBps = 0n;
      if (riskAssessed) {
        try { rateBps = (await publicClient.readContract({ address: ADDR.cover, abi: aegisCoverAbi, functionName: "rateBps", args: [target] })) as bigint; } catch { /* ignore */ }
      }

      let observed = 0n;
      try {
        observed = isPrice
          ? ((await publicClient.readContract({ address: target, abi: mockStableAbi, functionName: "price" })) as bigint)
          : await publicClient.getBalance({ address: target });
      } catch { /* ignore */ }

      out.push({ target, adapter, name, perilKey, peril, isPrice, active, observed, riskScore, riskAssessed, rateBps, riskAssessedAt, settled, samples: [] });
    }
    return out;
  } catch {
    return []; // legacy core (no registry) or transient RPC error
  }
}
