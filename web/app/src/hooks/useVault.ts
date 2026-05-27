import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { publicClient, ADDR } from "../chain/config";
import { aegisCoverAbi } from "../chain/abi";

/**
 * LP underwriting pool state. Reads are tolerant: against a cover WITHOUT the vault (the legacy
 * core, pre-redeploy) every call reverts and we report `supported: false` with zeros, so the panel
 * degrades gracefully until the new core is live. Writes (deposit/withdraw) live in <LpPanel/>,
 * matching the codebase convention (write logic in components, reads in hooks).
 */
export interface VaultState {
  freeAssets: bigint;    // pool NAV = balance − totalClaimable
  totalShares: bigint;
  lockedCapacity: bigint; // Σ active maxPayout — the solvency lien
  totalClaimable: bigint;
  yourShares: bigint;
  yourValue: bigint;     // previewValue(account)
  supported: boolean;    // false against a cover without the vault
  loaded: boolean;
}

const EMPTY: VaultState = {
  freeAssets: 0n, totalShares: 0n, lockedCapacity: 0n, totalClaimable: 0n,
  yourShares: 0n, yourValue: 0n, supported: false, loaded: false,
};

export interface UseVault extends VaultState {
  refetch: () => Promise<void>;
}

export function useVault(account: Address | null, intervalMs = 5000): UseVault {
  const [s, setS] = useState<VaultState>(EMPTY);

  const refetch = useCallback(async () => {
    try {
      const pool = await publicClient.multicall({
        allowFailure: true,
        deployless: true, // Somnia Shannon has no deployed multicall3
        contracts: [
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "freeAssets" },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "totalShares" },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "lockedCapacity" },
          { address: ADDR.cover, abi: aegisCoverAbi, functionName: "totalClaimable" },
        ],
      });
      const supported = pool[0].status === "success";
      const freeAssets = (pool[0].status === "success" ? pool[0].result : 0n) as bigint;
      const totalShares = (pool[1].status === "success" ? pool[1].result : 0n) as bigint;
      const lockedCapacity = (pool[2].status === "success" ? pool[2].result : 0n) as bigint;
      const totalClaimable = (pool[3].status === "success" ? pool[3].result : 0n) as bigint;

      let yourShares = 0n;
      let yourValue = 0n;
      if (account && supported) {
        const w = await publicClient.multicall({
          allowFailure: true, deployless: true,
          contracts: [
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "shares", args: [account] },
            { address: ADDR.cover, abi: aegisCoverAbi, functionName: "previewValue", args: [account] },
          ],
        });
        yourShares = (w[0].status === "success" ? w[0].result : 0n) as bigint;
        yourValue = (w[1].status === "success" ? w[1].result : 0n) as bigint;
      }
      setS({ freeAssets, totalShares, lockedCapacity, totalClaimable, yourShares, yourValue, supported, loaded: true });
    } catch {
      setS((p) => ({ ...p, loaded: true })); // keep last good values on transient RPC errors
    }
  }, [account]);

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) void refetch(); };
    run();
    const h = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(h); };
  }, [refetch, intervalMs]);

  return { ...s, refetch };
}

/** NAV per share scaled to 1e18 (1.0 == shares track assets 1:1). 0 when the pool is empty. */
export function navPerShare(v: VaultState): bigint {
  if (v.totalShares === 0n) return 0n;
  return (v.freeAssets * 10n ** 18n) / v.totalShares;
}

/** Pool utilisation in bps: lockedCapacity / freeAssets. 0 when there are no free assets. */
export function utilisationBps(v: VaultState): number {
  if (v.freeAssets === 0n) return 0;
  return Number((v.lockedCapacity * 10_000n) / v.freeAssets);
}
