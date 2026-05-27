import { describe, it, expect } from "vitest";
import { hexToString } from "viem";
import { buildExploitEvidence } from "../chain/evidence";

describe("buildExploitEvidence", () => {
  it("produces canonical sorted-key JSON as 0x-hex bytes", () => {
    const hex = buildExploitEvidence({
      target: "0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1",
      observedAt: 1716000000,
      tvlBefore: 10n ** 17n, tvlAfter: 0n, windowSeconds: 38,
    });
    expect(hex.startsWith("0x")).toBe(true);
    const json = JSON.parse(hexToString(hex as `0x${string}`));
    expect(json.schema).toBe("aegis-exploit-evidence/1");
    expect(json.tvl.deltaBps).toBe(-10000); // 100% drop
    // keys are sorted at every object level (deterministic)
    expect(Object.keys(json)).toEqual([...Object.keys(json)].sort());
    expect(typeof json.tvl.before).toBe("string"); // bigints as decimal strings
  });
});
