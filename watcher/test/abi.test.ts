import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import { coverAbi, encodeRequestCheck } from "../src/abi.js";

describe("encodeRequestCheck", () => {
  it("encodes a requestCheck call that round-trips through the ABI", () => {
    const target = "0x000000000000000000000000000000000000a11c" as const;
    const evidence = "0xdeadbeef" as const;
    const data = encodeRequestCheck(target, evidence);
    expect(data.startsWith("0x")).toBe(true);

    const decoded = decodeFunctionData({ abi: coverAbi, data });
    expect(decoded.functionName).toBe("requestCheck");
    expect(decoded.args[0]).toBe(target);
    expect(decoded.args[1]).toBe(evidence);
  });
});
