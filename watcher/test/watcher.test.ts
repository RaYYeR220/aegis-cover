import { describe, it, expect, vi } from "vitest";
import { runWatchCycle, type WatchDeps, type TargetState } from "../src/watcher.js";
import type { TargetConfig } from "../src/types.js";

const wei = (n: number) => BigInt(n) * 10n ** 18n;
const target: TargetConfig = { address: "0x000000000000000000000000000000000000a11c", kind: "tvl", dropThresholdBps: 3000 };
const cfg = { windowSeconds: 120, cooldownMs: 60_000 };

function freshState(): TargetState {
  return { samples: [], lastTriggeredMs: 0 };
}

function deps(over: Partial<WatchDeps>): WatchDeps {
  return {
    getTvl: vi.fn(async () => wei(5)),
    getObservedValue: vi.fn(async () => wei(5)),
    isSettled: vi.fn(async () => false),
    sendCheck: vi.fn(async () => "0xhash" as `0x${string}`),
    getAlerts: vi.fn(async () => []),
    getRiskAssessedAt: vi.fn(async () => 0n),
    sendRiskAssessment: vi.fn(async () => "0xhash" as `0x${string}`),
    ...over,
  };
}

describe("runWatchCycle", () => {
  it("does nothing on a stable TVL", async () => {
    const d = deps({});
    const state = freshState();
    await runWatchCycle(target, d, state, cfg, 1_000); // sample 1
    const action = await runWatchCycle(target, d, state, cfg, 6_000); // sample 2, stable
    expect(action.triggered).toBe(false);
    expect(d.sendCheck).not.toHaveBeenCalled();
  });

  it("triggers a check when TVL crashes", async () => {
    const tvls = [wei(5), wei(5), 0n];
    let i = 0;
    const d = deps({ getObservedValue: vi.fn(async () => tvls[i++]!) });
    const state = freshState();
    await runWatchCycle(target, d, state, cfg, 1_000);
    await runWatchCycle(target, d, state, cfg, 6_000);
    const action = await runWatchCycle(target, d, state, cfg, 11_000); // crash
    expect(action.triggered).toBe(true);
    expect(d.sendCheck).toHaveBeenCalledTimes(1);
    const [calledTarget, calledEvidence] = (d.sendCheck as any).mock.calls[0];
    expect(calledTarget).toBe(target.address);
    expect(calledEvidence.startsWith("0x")).toBe(true);
    expect(state.lastTriggeredMs).toBe(11_000);
  });

  it("skips settled targets without sampling or sending", async () => {
    const d = deps({ isSettled: vi.fn(async () => true) });
    const state = freshState();
    const action = await runWatchCycle(target, d, state, cfg, 1_000);
    expect(action.triggered).toBe(false);
    expect(action.reason).toBe("settled");
    expect(d.getObservedValue).not.toHaveBeenCalled();
    expect(d.sendCheck).not.toHaveBeenCalled();
  });

  it("respects the cooldown after a trigger", async () => {
    const tvls = [wei(5), 0n, 0n];
    let i = 0;
    const d = deps({ getObservedValue: vi.fn(async () => tvls[i++]!) });
    const state = freshState();
    await runWatchCycle(target, d, state, cfg, 1_000);
    const first = await runWatchCycle(target, d, state, cfg, 6_000); // crash -> trigger
    expect(first.triggered).toBe(true);
    const second = await runWatchCycle(target, d, state, cfg, 7_000); // within cooldown
    expect(second.triggered).toBe(false);
    expect(second.reason).toBe("cooldown");
    expect(d.sendCheck).toHaveBeenCalledTimes(1);
  });

  it("includes injected web2 alerts in the evidence", async () => {
    const tvls = [wei(5), 0n];
    let i = 0;
    const d = deps({
      getObservedValue: vi.fn(async () => tvls[i++]!),
      getAlerts: vi.fn(async () => ["Security alert: suspected exploit"]),
    });
    const state = freshState();
    await runWatchCycle(target, d, state, cfg, 1_000);
    const action = await runWatchCycle(target, d, state, cfg, 6_000);
    expect(action.triggered).toBe(true);
    const evidenceHex = (d.sendCheck as any).mock.calls[0][1] as string;
    const json = Buffer.from(evidenceHex.slice(2), "hex").toString("utf8");
    expect(json).toContain("Security alert: suspected exploit");
  });

  it("triggers a depeg check when a price target falls below the band", async () => {
    const peg = wei(1);
    const prices = [peg, (peg * 9000n) / 10000n]; // at peg, then 10% below
    let i = 0;
    const priceTarget: TargetConfig = {
      address: "0x000000000000000000000000000000000000b22d",
      kind: "price",
      dropThresholdBps: 3000,
      pegWei: peg,
      depegBandBps: 200,
    };
    const d = deps({ getObservedValue: vi.fn(async () => prices[i++]!) });
    const state = freshState();
    await runWatchCycle(priceTarget, d, state, cfg, 1_000); // at peg → no trigger
    const action = await runWatchCycle(priceTarget, d, state, cfg, 6_000); // depeg → trigger
    expect(action.triggered).toBe(true);
    expect(d.sendCheck).toHaveBeenCalledTimes(1);
    const evidenceHex = (d.sendCheck as any).mock.calls[0][1] as string;
    const json = Buffer.from(evidenceHex.slice(2), "hex").toString("utf8");
    expect(json).toContain("aegis-depeg-evidence/1");
  });
});
