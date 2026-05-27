import { formatEther } from "viem";
import type { WatcherConfig } from "./types.js";
import type { WatchDeps, TargetState } from "./watcher.js";
import { runWatchCycle } from "./watcher.js";
import { shouldAssess } from "./keeper.js";
import { buildRiskFacts } from "./riskFacts.js";

// Emit a "still alive" heartbeat every Nth quiet poll so the watcher is visibly monitoring
// (otherwise it's silent between the start banner and the TRIGGERED line).
const HEARTBEAT_EVERY_TICKS = 6;

export interface RunningWatcher {
  stop(): void;
}

/** Per-target risk-keeper state (in-process). */
interface KeeperState {
  lastFiredMs: number;
}

/** Start polling every target on an interval. Returns a handle to stop it. */
export function startWatcher(cfg: WatcherConfig, deps: WatchDeps): RunningWatcher {
  const states = new Map<string, TargetState>();
  for (const t of cfg.targets) states.set(t.address, { samples: [], lastTriggeredMs: 0 });

  let ticks = 0;
  const tick = async () => {
    ticks++;
    for (const target of cfg.targets) {
      const state = states.get(target.address)!;
      try {
        const action = await runWatchCycle(target, deps, state, cfg, Date.now());
        if (action.triggered) {
          console.log(`[watcher] ${target.address} TRIGGERED check: ${action.reason} (severity ${action.severityScore}) tx=${action.txHash}`);
        } else if (action.reason !== "no-candidate" && action.reason !== "insufficient-samples" && action.reason !== "at-peg") {
          console.log(`[watcher] ${target.address}: ${action.reason}`);
        } else if (ticks % HEARTBEAT_EVERY_TICKS === 0 && action.observedWei !== undefined) {
          const unit = target.kind === "price"
            ? `price ${formatEther(action.observedWei)} (peg ${formatEther(target.pegWei ?? 10n ** 18n)})`
            : `TVL ${formatEther(action.observedWei)} STT`;
          console.log(`[watcher] ${target.address} monitoring — ${unit}`);
        }
      } catch (err) {
        console.error(`[watcher] ${target.address} cycle error:`, err);
      }
    }
  };

  let handle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    void tick().finally(() => {
      if (!stopped) handle = setTimeout(schedule, cfg.pollIntervalMs);
    });
  };

  schedule();

  // ── Periodic AI risk-keeper (independent, slower cadence; disabled when interval is 0) ──
  let keeperHandle: ReturnType<typeof setTimeout> | undefined;
  if (cfg.riskAssessIntervalMs > 0) {
    const keeperStates = new Map<string, KeeperState>();
    for (const t of cfg.targets) keeperStates.set(t.address, { lastFiredMs: 0 });
    // Check often enough to notice staleness, but never more than once a minute.
    const checkEveryMs = Math.max(1000, Math.min(cfg.riskAssessIntervalMs, 60_000));

    const keeperTick = async () => {
      const nowMs = Date.now();
      for (const target of cfg.targets) {
        const ks = keeperStates.get(target.address)!;
        try {
          const lastAssessedAtSec = await deps.getRiskAssessedAt(target.address);
          const decision = shouldAssess({
            lastAssessedAtSec,
            lastFiredMs: ks.lastFiredMs,
            nowMs,
            intervalMs: cfg.riskAssessIntervalMs,
            minGapMs: cfg.riskAssessMinGapMs,
          });
          if (!decision.fire) continue;
          const tvlWei = await deps.getTvl(target.address);
          const facts = buildRiskFacts({
            target: target.address,
            tvlWei,
            audited: false,
            ageDays: 12,
            adminControlled: true,
            priorIncident: true,
          });
          const txHash = await deps.sendRiskAssessment(target.address, facts.bytes);
          ks.lastFiredMs = nowMs;
          console.log(`[keeper] ${target.address} risk assessment fired (${decision.reason}) tx=${txHash}`);
        } catch (err) {
          console.error(`[keeper] ${target.address} error:`, err);
        }
      }
    };

    const scheduleKeeper = () => {
      if (stopped) return;
      void keeperTick().finally(() => {
        if (!stopped) keeperHandle = setTimeout(scheduleKeeper, checkEveryMs);
      });
    };
    console.log(`[keeper] enabled — refresh every ${cfg.riskAssessIntervalMs}ms (check ${checkEveryMs}ms, min-gap ${cfg.riskAssessMinGapMs}ms)`);
    scheduleKeeper();
  }

  return {
    stop: () => {
      stopped = true;
      if (handle) clearTimeout(handle);
      if (keeperHandle) clearTimeout(keeperHandle);
    },
  };
}
