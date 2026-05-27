import { useEffect, useState, useCallback } from "react";
import { ActivityRow } from "../components/ActivityRow";
import { DEMO_ACTIVITY, LIVE_PROTOCOL, LIVE_DEPEG_PROTOCOL, type ActivityItem, type CoverTypeName } from "../data/demo";
import { publicClient, ADDR, isAddrSet } from "../chain/config";
import { aegisCoverAbi } from "../chain/abi";
import { fmtSTT } from "../chain/format";

type FilterType = "all" | "exploit" | "depeg" | "slashing" | "bridge" | "oracle" | "governance" | "policy" | "claim";

const FILTER_LABELS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "exploit", label: "Exploit" },
  { key: "depeg", label: "Depeg" },
  { key: "slashing", label: "Slashing" },
  { key: "bridge", label: "Bridge" },
  { key: "oracle", label: "Oracle" },
  { key: "governance", label: "Governance" },
  { key: "policy", label: "Policy" },
  { key: "claim", label: "Claim" },
];

function fmtRelTime(blockTs?: bigint): string {
  if (!blockTs) return "—";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const diff = nowSec - blockTs;
  if (diff < 10n) return "just now";
  if (diff < 60n) return `${diff}s ago`;
  if (diff < 3600n) {
    const m = diff / 60n;
    const s = diff % 60n;
    return s > 0n ? `${m}m ${s}s ago` : `${m}m ago`;
  }
  const h = diff / 3600n;
  return `${h}h ago`;
}

type LogEntry = {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}` | null;
  eventName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>;
  blockTimestamp?: bigint;
};

// Derive the protocol name + peril from a check/verdict event's `target` arg, so depeg events on
// MockStable are labelled as Depeg (not hardcoded to the exploit target).
function targetMeta(target?: string): { name: string; peril: CoverTypeName } {
  const t = (target ?? "").toLowerCase();
  if (isAddrSet(ADDR.stable) && t === ADDR.stable.toLowerCase()) {
    return { name: LIVE_DEPEG_PROTOCOL, peril: "Depeg" };
  }
  return { name: LIVE_PROTOCOL, peril: "Exploit" };
}

function mapLogToActivity(log: LogEntry): ActivityItem | null {
  const ts = fmtRelTime(log.blockTimestamp);
  const tx = log.transactionHash ?? undefined;

  switch (log.eventName) {
    case "CheckRequested": {
      const m = targetMeta(log.args.target);
      return {
        ts,
        type: m.peril,
        label: `${m.name} · ${m.peril.toLowerCase()} check opened`,
        value: "—",
        tx,
      };
    }
    case "VerdictReceived": {
      const m = targetMeta(log.args.target);
      const confirmed = Boolean(log.args.confirmed);
      const score = log.args.score != null ? String(log.args.score) : "?";
      return {
        ts,
        type: m.peril,
        label: `${m.name} · verdict ${confirmed ? "CONFIRMED" : "NOT confirmed"} (median ${score})`,
        value: `median ${score}`,
        tx,
      };
    }
    case "PolicyBought": {
      const policyId = log.args.policyId != null ? String(log.args.policyId) : "?";
      const sumInsured: bigint = log.args.sumInsured ?? 0n;
      return {
        ts,
        type: "Policy" as const,
        label: `Policy #${policyId} bought · ${fmtSTT(sumInsured)} cover`,
        value: fmtSTT(sumInsured),
        tx,
      };
    }
    case "PolicySettled": {
      const policyId = log.args.policyId != null ? String(log.args.policyId) : "?";
      const payout: bigint = log.args.payout ?? 0n;
      return {
        ts,
        type: "Claim" as const,
        label: `Policy #${policyId} settled · payout ${fmtSTT(payout)} STT`,
        value: `${fmtSTT(payout)} STT`,
        tx,
      };
    }
    case "Payout": {
      const totalCredited: bigint = log.args.totalCredited ?? 0n;
      const policiesPaid = log.args.policiesPaid != null ? String(log.args.policiesPaid) : "?";
      return {
        ts,
        type: "Claim" as const,
        label: `Payout · ${fmtSTT(totalCredited)} STT to ${policiesPaid} policies`,
        value: `${fmtSTT(totalCredited)} STT`,
        tx,
      };
    }
    case "Claimed": {
      const amount: bigint = log.args.amount ?? 0n;
      return {
        ts,
        type: "Claim" as const,
        label: `Claimed ${fmtSTT(amount)} STT`,
        value: `${fmtSTT(amount)} STT`,
        tx,
      };
    }
    case "RiskAssessed": {
      const score = log.args.score != null ? String(log.args.score) : "?";
      const rateBps = log.args.rateBps != null ? Number(log.args.rateBps) : 0;
      return {
        ts,
        type: "Policy" as const,
        label: `Risk assessed · score ${score} → ${rateBps / 100}%`,
        value: `${rateBps / 100}%`,
        tx,
      };
    }
    default:
      return null;
  }
}

// Helper: fetch logs for a single event, with fromBlock fallback
async function fetchEventLogs(
  eventName: "CheckRequested" | "VerdictReceived" | "PolicyBought" | "PolicySettled" | "Payout" | "Claimed" | "RiskAssessed",
  fromBlock: bigint
): Promise<LogEntry[]> {
  const baseParams = { address: ADDR.cover, abi: aegisCoverAbi, eventName, fromBlock, toBlock: "latest" as const };
  try {
    const logs = await publicClient.getContractEvents(baseParams);
    return logs.map((l) => ({
      blockNumber: (l as { blockNumber?: bigint }).blockNumber ?? 0n,
      logIndex: (l as { logIndex?: number }).logIndex ?? 0,
      transactionHash: (l as { transactionHash?: `0x${string}` }).transactionHash ?? null,
      eventName: l.eventName as string,
      args: l.args as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

const EVENT_NAMES = [
  "CheckRequested",
  "VerdictReceived",
  "PolicyBought",
  "PolicySettled",
  "Payout",
  "Claimed",
  "RiskAssessed",
] as const;

type WatchedEventName = typeof EVENT_NAMES[number];

export function Activity() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [liveRows, setLiveRows] = useState<ActivityItem[]>([]);

  const prependRows = useCallback((newItems: ActivityItem[]) => {
    if (newItems.length === 0) return;
    setLiveRows((prev) => [...newItems, ...prev]);
  }, []);

  useEffect(() => {
    const unwatchFns: Array<() => void> = [];
    let cancelled = false;

    async function fetchLogs() {
      try {
        const latestBlock = await publicClient.getBlockNumber();
        // Shannon's RPC caps eth_getLogs at a 1000-block range — a larger window silently fails the
        // historical load (only the live watch then populates). Stay under the cap.
        const WINDOW = 900n;
        const fromBlock = latestBlock > WINDOW ? latestBlock - WINDOW : 0n;

        // Fetch all event types in parallel
        const allEntries = (
          await Promise.all(EVENT_NAMES.map((name) => fetchEventLogs(name, fromBlock)))
        ).flat();

        if (cancelled) return;

        // Fetch block timestamps for relative time display
        const blockNums = [...new Set(allEntries.map((l) => l.blockNumber).filter((b) => b > 0n))];
        const blockTsMap = new Map<bigint, bigint>();
        await Promise.all(
          blockNums.map(async (bn) => {
            try {
              const blk = await publicClient.getBlock({ blockNumber: bn });
              blockTsMap.set(bn, blk.timestamp);
            } catch {
              // leave absent
            }
          })
        );

        if (cancelled) return;

        // Sort newest first
        const sorted = [...allEntries].sort((a, b) => {
          const bn = b.blockNumber - a.blockNumber;
          if (bn !== 0n) return Number(bn);
          return b.logIndex - a.logIndex;
        });

        const items: ActivityItem[] = [];
        for (const entry of sorted) {
          const withTs: LogEntry = {
            ...entry,
            blockTimestamp: entry.blockNumber > 0n ? blockTsMap.get(entry.blockNumber) : undefined,
          };
          const item = mapLogToActivity(withTs);
          if (item) items.push(item);
        }

        if (!cancelled) {
          setLiveRows(items);
        }
      } catch {
        // RPC failure — just show demo seed rows
      }
    }

    fetchLogs();
    // Re-pull periodically so the feed stays current without a page reload, even if a live
    // subscription drops a log (the historical fetch is authoritative and de-duped).
    const refetchTimer = setInterval(() => { void fetchLogs(); }, 8000);

    // Watch for new events in real-time
    for (const eventName of EVENT_NAMES) {
      try {
        const unwatch = publicClient.watchContractEvent({
          address: ADDR.cover,
          abi: aegisCoverAbi,
          eventName: eventName as WatchedEventName,
          onLogs(logs) {
            if (cancelled) return;
            const newItems: ActivityItem[] = [];
            for (const log of logs) {
              const entry: LogEntry = {
                blockNumber: (log as { blockNumber?: bigint }).blockNumber ?? 0n,
                logIndex: (log as { logIndex?: number }).logIndex ?? 0,
                transactionHash: (log as { transactionHash?: `0x${string}` }).transactionHash ?? null,
                eventName: log.eventName as string,
                args: log.args as Record<string, unknown>,
              };
              const item = mapLogToActivity(entry);
              if (item) newItems.push(item);
            }
            prependRows(newItems);
          },
        });
        unwatchFns.push(unwatch);
      } catch {
        // skip if watch fails
      }
    }

    return () => {
      cancelled = true;
      clearInterval(refetchTimer);
      for (const unwatch of unwatchFns) {
        try { unwatch(); } catch { /* ignore */ }
      }
    };
  }, [prependRows]);

  // Combine live rows first, then demo seed rows
  const allRows: ActivityItem[] = [...liveRows, ...DEMO_ACTIVITY];

  const filteredRows =
    filter === "all"
      ? allRows
      : allRows.filter((r) => r.type.toLowerCase() === filter);

  const count = filteredRows.length;

  return (
    <div className="page active">
      <div className="activity-layout">
        <div className="activity-header">
          <div className="activity-title">Event log · all protocols</div>
          <div className="activity-filters">
            {FILTER_LABELS.map(({ key, label }) => (
              <button
                key={key}
                className={`filter-btn${filter === key ? " active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="activity-count-info">
            {count} event{count !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="activity-cols">
          <div className="activity-col-head">Time</div>
          <div className="activity-col-head">Type</div>
          <div className="activity-col-head">Event</div>
          <div className="activity-col-head" style={{ textAlign: "right", paddingRight: 16 }}>Value</div>
          <div className="activity-col-head" style={{ textAlign: "right" }}>Tx</div>
        </div>

        <div className="activity-list">
          {filteredRows.map((item, i) => (
            <ActivityRow key={`${item.type}-${item.ts}-${i}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}
