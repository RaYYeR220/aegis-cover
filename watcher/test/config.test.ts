import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base: Record<string, string> = {
  RPC_URL: "https://rpc.example",
  COVER_ADDRESS: "0x000000000000000000000000000000000000c0fe",
  TARGETS: "0x0000000000000000000000000000000000000a11,0x0000000000000000000000000000000000000b22",
  DROP_THRESHOLD_BPS: "3000",
  POLL_INTERVAL_MS: "5000",
  WINDOW_SECONDS: "120",
  COOLDOWN_MS: "60000",
};

describe("loadConfig", () => {
  it("parses a valid env into a WatcherConfig", () => {
    const cfg = loadConfig(base, { dryRun: true });
    expect(cfg.rpcUrl).toBe("https://rpc.example");
    expect(cfg.coverAddress).toBe("0x000000000000000000000000000000000000c0fe");
    expect(cfg.targets).toHaveLength(2);
    expect(cfg.targets[0]!.address).toBe("0x0000000000000000000000000000000000000a11");
    expect(cfg.targets[0]!.dropThresholdBps).toBe(3000);
    expect(cfg.pollIntervalMs).toBe(5000);
    expect(cfg.dryRun).toBe(true);
  });

  it("throws when a required field is missing", () => {
    const { RPC_URL, ...missing } = base;
    expect(() => loadConfig(missing, { dryRun: true })).toThrow(/RPC_URL/);
  });

  it("throws when not dry-run and PRIVATE_KEY is absent", () => {
    expect(() => loadConfig(base, { dryRun: false })).toThrow(/PRIVATE_KEY/);
  });

  it("throws on a malformed target address", () => {
    expect(() => loadConfig({ ...base, TARGETS: "0xnothex" }, { dryRun: true })).toThrow(/target/i);
  });

  it("stores a valid PRIVATE_KEY when not dry-run", () => {
    const key = ("0x" + "a".repeat(64));
    const cfg = loadConfig({ ...base, PRIVATE_KEY: key }, { dryRun: false });
    expect(cfg.privateKey).toBe(key);
  });

  it("throws when COVER_ADDRESS is missing", () => {
    const { COVER_ADDRESS, ...missing } = base;
    expect(() => loadConfig(missing, { dryRun: true })).toThrow(/COVER_ADDRESS/);
  });

  it("throws when WINDOW_SECONDS is zero", () => {
    expect(() => loadConfig({ ...base, WINDOW_SECONDS: "0" }, { dryRun: true })).toThrow(/WINDOW_SECONDS/);
  });

  it("defaults the risk keeper to disabled (0) and a 5m min-gap", () => {
    const cfg = loadConfig(base, { dryRun: true });
    expect(cfg.riskAssessIntervalMs).toBe(0);
    expect(cfg.riskAssessMinGapMs).toBe(300000);
  });

  it("parses a provided risk-keeper interval", () => {
    const cfg = loadConfig({ ...base, RISK_ASSESS_INTERVAL_MS: "3600000", RISK_ASSESS_MIN_GAP_MS: "60000" }, { dryRun: true });
    expect(cfg.riskAssessIntervalMs).toBe(3600000);
    expect(cfg.riskAssessMinGapMs).toBe(60000);
  });

  it("defaults all targets to the tvl kind when TARGETS_KIND is absent", () => {
    const cfg = loadConfig(base, { dryRun: true });
    expect(cfg.targets[0]!.kind).toBe("tvl");
    expect(cfg.targets[1]!.kind).toBe("tvl");
  });

  it("parses per-target kind/peg/band for a price (depeg) target", () => {
    const cfg = loadConfig(
      {
        ...base,
        TARGETS_KIND: "tvl,price",
        PEG_WEI: ",1000000000000000000", // index-aligned: tvl entry empty, price entry = 1e18
        DEPEG_BAND_BPS: ",200",
      },
      { dryRun: true },
    );
    expect(cfg.targets[0]!.kind).toBe("tvl");
    expect(cfg.targets[1]!.kind).toBe("price");
    expect(cfg.targets[1]!.pegWei).toBe(10n ** 18n);
    expect(cfg.targets[1]!.depegBandBps).toBe(200);
  });
});
