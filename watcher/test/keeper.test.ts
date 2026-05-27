import { describe, it, expect } from "vitest";
import { shouldAssess } from "../src/keeper.js";

const base = { intervalMs: 3_600_000, minGapMs: 300_000 }; // 1h refresh, 5m in-process gap
const NOW = 1_000_000_000_000;

describe("shouldAssess", () => {
  it("fires when never assessed (lastAssessedAtSec=0)", () => {
    expect(shouldAssess({ lastAssessedAtSec: 0n, lastFiredMs: 0, nowMs: NOW, ...base }).fire).toBe(true);
  });

  it("skips when the cached score is fresh", () => {
    const assessed = BigInt(Math.floor(NOW / 1000) - 60); // 60s ago
    expect(shouldAssess({ lastAssessedAtSec: assessed, lastFiredMs: 0, nowMs: NOW, ...base }).fire).toBe(false);
  });

  it("fires when the cached score is older than the interval", () => {
    const assessed = BigInt(Math.floor(NOW / 1000) - 7200); // 2h ago > 1h interval
    expect(shouldAssess({ lastAssessedAtSec: assessed, lastFiredMs: 0, nowMs: NOW, ...base }).fire).toBe(true);
  });

  it("respects the in-process min-gap after a recent fire", () => {
    // fired 60s ago < 5m gap → suppressed even though never assessed on-chain
    expect(shouldAssess({ lastAssessedAtSec: 0n, lastFiredMs: NOW - 60_000, nowMs: NOW, ...base }).fire).toBe(false);
  });
});
