import { describe, it, expect } from "vitest";
import { decodeCommittee, encodeAddressArray } from "../chain/committee";

describe("decodeCommittee", () => {
  it("returns null on undecodable data", () => {
    expect(decodeCommittee("0x")).toBeNull();
  });
  it("extracts 5 addresses from an abi-encoded address[] tail", () => {
    // address[] of 5 known validators, abi-encoded (offset+len+5 words) appended after a head word
    const addrs = ["0x7A3f000000000000000000000000000000000b21","0x4eD9000000000000000000000000000000000aaF",
      "0x12C800000000000000000000000000000000ee01","0xBb62000000000000000000000000000000003399",
      "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"];
    const out = decodeCommittee(encodeAddressArray(addrs));
    expect(out).toHaveLength(5);
    expect(out![4].toLowerCase()).toBe(addrs[4].toLowerCase());
  });
});
