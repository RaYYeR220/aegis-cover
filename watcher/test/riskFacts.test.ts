import { describe, it, expect } from "vitest";
import { hexToString } from "viem";
import { buildRiskFacts } from "../src/riskFacts.js";

const input = {
  target: "0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1" as const,
  tvlWei: 100000000000000000n,
  audited: false,
  ageDays: 12,
  adminControlled: true,
  priorIncident: true,
};

describe("buildRiskFacts", () => {
  it("produces canonical sorted-key JSON (schema aegis-risk-facts/1) as hex", () => {
    const { json, bytes } = buildRiskFacts(input);
    const obj = JSON.parse(hexToString(bytes));
    expect(obj.schema).toBe("aegis-risk-facts/1");
    expect(obj.tvl).toBe("100000000000000000"); // bigint as decimal string
    expect(obj.audited).toBe(false);
    expect(Object.keys(obj)).toEqual([...Object.keys(obj)].sort()); // sorted at top level
    expect(json).toBe(hexToString(bytes)); // json matches the encoded bytes
  });

  it("is deterministic for identical input", () => {
    expect(buildRiskFacts(input).json).toBe(buildRiskFacts(input).json);
  });
});
