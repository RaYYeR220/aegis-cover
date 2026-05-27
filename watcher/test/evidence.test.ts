import { describe, it, expect } from "vitest";
import { stableStringify, buildEvidence, buildDepegEvidence } from "../src/evidence.js";
import type { TvlSample, TvlSignal } from "../src/types.js";

const wei = (n: number) => BigInt(n) * 10n ** 18n;

const sig: TvlSignal = {
  current: 0n,
  baseline: wei(5),
  deltaBps: -10000,
  largestDropBps: 10000,
  windowSeconds: 120,
  sampleCount: 3,
};
const samples: TvlSample[] = [
  { ts: 0, tvl: wei(5) },
  { ts: 5_000, tvl: wei(5) },
  { ts: 10_000, tvl: 0n },
];

describe("stableStringify", () => {
  it("orders object keys deterministically regardless of insertion order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("buildEvidence", () => {
  it("produces identical bytes for identical inputs (validator-reproducible)", () => {
    const a = buildEvidence({ target: "0x000000000000000000000000000000000000a11c", signal: sig, samples, web2Alerts: ["x"], observedAt: 10_000 });
    const b = buildEvidence({ target: "0x000000000000000000000000000000000000a11c", signal: sig, samples, web2Alerts: ["x"], observedAt: 10_000 });
    expect(a.bytes).toBe(b.bytes);
    expect(a.bytes.startsWith("0x")).toBe(true);
  });

  it("encodes the key signals into the JSON packet", () => {
    const e = buildEvidence({ target: "0x000000000000000000000000000000000000a11c", signal: sig, samples, web2Alerts: ["alert!"], observedAt: 10_000 });
    const parsed = JSON.parse(e.json);
    expect(parsed.schema).toBe("aegis-exploit-evidence/1");
    expect(parsed.target).toBe("0x000000000000000000000000000000000000a11c");
    expect(parsed.tvl.before).toBe(wei(5).toString());
    expect(parsed.tvl.after).toBe("0");
    expect(parsed.tvl.deltaBps).toBe(-10000);
    expect(parsed.signals.largestDropBps).toBe(10000);
    expect(parsed.signals.web2Alerts).toEqual(["alert!"]);
    expect(parsed.tvl.samples).toHaveLength(3);
    expect(parsed.tvl.samples[2].tvl).toBe("0");
  });
});

describe("buildDepegEvidence", () => {
  const peg = wei(1);
  const depegged = (peg * 9000n) / 10000n; // 10% below peg
  const priceSamples: TvlSample[] = [
    { ts: 0, tvl: peg },
    { ts: 5_000, tvl: depegged },
  ];
  const args = {
    target: "0x000000000000000000000000000000000000a11c" as const,
    priceWei: depegged,
    pegWei: peg,
    depegBandBps: 200,
    samples: priceSamples,
    observedAt: 5_000,
  };

  it("encodes a depeg packet with price/peg/deviation/direction", () => {
    const e = buildDepegEvidence(args);
    const p = JSON.parse(e.json);
    expect(p.schema).toBe("aegis-depeg-evidence/1");
    expect(p.target).toBe(args.target);
    expect(p.price.current).toBe(depegged.toString());
    expect(p.price.peg).toBe(peg.toString());
    expect(p.price.deviationBps).toBe(1000); // 10% below peg
    expect(p.price.direction).toBe("below");
    expect(p.price.bandBps).toBe(200);
    expect(p.price.samples).toHaveLength(2);
    expect(e.bytes.startsWith("0x")).toBe(true);
  });

  it("is deterministic for identical inputs (validator-reproducible)", () => {
    expect(buildDepegEvidence(args).bytes).toBe(buildDepegEvidence(args).bytes);
  });
});
