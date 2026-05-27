import { encodeFunctionData } from "viem";
import type { Address, Hex } from "./types.js";

/** Minimal slice of AegisCover the watcher needs. */
export const coverAbi = [
  {
    type: "function",
    name: "requestCheck",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "evidence", type: "bytes" },
    ],
    outputs: [{ name: "questionId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "targetSettled",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "requestRiskAssessment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "facts", type: "bytes" },
    ],
    outputs: [{ name: "questionId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "riskAssessedAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "riskAssessed",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Calldata helper for debugging / off-runtime tooling (the wallet client encodes internally). */
export function encodeRequestCheck(target: Address, evidence: Hex): Hex {
  return encodeFunctionData({ abi: coverAbi, functionName: "requestCheck", args: [target, evidence] });
}
