import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coverAbi } from "./abi.js";
import type { Address, Hex, TargetKind, WatcherConfig } from "./types.js";
import type { WatchDeps } from "./watcher.js";

// Minimal ABI to read a pegged-asset target's price (MockStable.price()).
const priceAbi = [
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Define the Somnia Shannon chain once so both the public and wallet clients share it.
const somniaShannon = defineChain({
  id: 50312,
  name: "Somnia Shannon Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

/**
 * Build the chain-backed dependencies for the watcher.
 * In dry-run, sendCheck logs the intended call and returns a synthetic hash.
 */
export function makeChainDeps(cfg: WatcherConfig): WatchDeps {
  const transport = http(cfg.rpcUrl);
  const publicClient = createPublicClient({ transport, chain: somniaShannon });

  const getTvl = (target: Address) => publicClient.getBalance({ address: target });

  // The value the detector watches: native balance for tvl targets, on-chain price() for price
  // (depeg) targets. getTvl stays the native balance (the risk-keeper uses it for risk facts).
  const getObservedValue = (target: Address, kind: TargetKind): Promise<bigint> =>
    kind === "price"
      ? (publicClient.readContract({ address: target, abi: priceAbi, functionName: "price" }) as Promise<bigint>)
      : getTvl(target);

  const isSettled = (target: Address) =>
    publicClient.readContract({
      address: cfg.coverAddress,
      abi: coverAbi,
      functionName: "targetSettled",
      args: [target],
    }) as Promise<boolean>;

  const getAlerts = async (_target: Address): Promise<string[]> => [];

  const getRiskAssessedAt = (target: Address) =>
    publicClient.readContract({
      address: cfg.coverAddress,
      abi: coverAbi,
      functionName: "riskAssessedAt",
      args: [target],
    }) as Promise<bigint>;

  // Consensus-triggering writes (requestCheck, requestRiskAssessment) invoke the native
  // createAdvancedRequest and need ~3.6M+ gas; Somnia under-estimates ~10–15× and the tx
  // OOGs silently (cast/viem exit 0). Pin an explicit 12M gas limit on both.
  const CONSENSUS_GAS = 12_000_000n;

  let sendCheck: WatchDeps["sendCheck"];
  let sendRiskAssessment: WatchDeps["sendRiskAssessment"];
  if (cfg.dryRun || !cfg.privateKey) {
    sendCheck = async (target: Address, evidence: Hex) => {
      console.log(`[dry-run] would requestCheck(${target}, ${evidence.slice(0, 18)}… ${(evidence.length - 2) / 2} bytes)`);
      return ("0x" + "0".repeat(64)) as Hex;
    };
    sendRiskAssessment = async (target: Address, facts: Hex) => {
      console.log(`[dry-run] would requestRiskAssessment(${target}, ${facts.slice(0, 18)}… ${(facts.length - 2) / 2} bytes)`);
      return ("0x" + "0".repeat(64)) as Hex;
    };
  } else {
    const account = privateKeyToAccount(cfg.privateKey);
    const wallet = createWalletClient({ account, transport, chain: somniaShannon });
    sendCheck = (target: Address, evidence: Hex) =>
      wallet.writeContract({
        address: cfg.coverAddress,
        abi: coverAbi,
        functionName: "requestCheck",
        args: [target, evidence],
        gas: CONSENSUS_GAS,
      }) as Promise<Hex>;
    sendRiskAssessment = (target: Address, facts: Hex) =>
      wallet.writeContract({
        address: cfg.coverAddress,
        abi: coverAbi,
        functionName: "requestRiskAssessment",
        args: [target, facts],
        gas: CONSENSUS_GAS,
      }) as Promise<Hex>;
  }

  return { getTvl, getObservedValue, isSettled, sendCheck, getAlerts, getRiskAssessedAt, sendRiskAssessment };
}
