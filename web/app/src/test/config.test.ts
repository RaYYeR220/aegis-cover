import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { ADDR, somniaShannon } from "../chain/config";
import { aegisCoverAbi, mockVaultAbi, oracleAbi } from "../chain/abi";

describe("chain config", () => {
  it("exposes checksummed addresses for the live contracts", () => {
    for (const a of Object.values(ADDR)) expect(getAddress(a)).toBe(a);
  });
  it("targets Somnia Shannon chain 50312", () => {
    expect(somniaShannon.id).toBe(50312);
    expect(somniaShannon.rpcUrls.default.http[0]).toMatch(/somnia/);
  });
  it("ABIs contain the functions/events the app uses", () => {
    const names = (abi: readonly any[]) => abi.map((x) => x.name);
    expect(names(mockVaultAbi)).toEqual(expect.arrayContaining(["tvl", "deposit", "exploit"]));
    expect(names(aegisCoverAbi)).toEqual(
      expect.arrayContaining(["quotePremium", "buyPolicy", "requestCheck", "claim", "claimable", "VerdictReceived", "CheckRequested"]),
    );
    expect(names(oracleAbi)).toEqual(expect.arrayContaining(["scoreThreshold", "VerdictFinalized"]));
  });
});
