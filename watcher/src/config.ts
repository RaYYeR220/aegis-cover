import type { Address, Hex, TargetConfig, TargetKind, WatcherConfig } from "./types.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
}

function asAddress(value: string, label: string): Address {
  if (!ADDRESS_RE.test(value)) {
    throw new Error(`Invalid ${label} address: ${value}`);
  }
  return value as Address;
}

function intEnv(env: Record<string, string | undefined>, key: string, fallback: number, min = 0): number {
  const v = env[key];
  if (v === undefined || v === "") return fallback;
  if (!/^\d+$/.test(v)) throw new Error(`Invalid integer env ${key}: ${v}`);
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`Invalid integer env ${key}: ${v} (min ${min})`);
  return n;
}

/** Split a CSV env into trimmed entries WITHOUT dropping empties — positions stay index-aligned. */
function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim());
}

function intStr(value: string | undefined, label: string, min = 0): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid integer ${label}: ${value}`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`Invalid integer ${label}: ${value} (min ${min})`);
  return n;
}

function bigintStr(value: string | undefined, label: string): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid bigint ${label}: ${value}`);
  return BigInt(value);
}

export function loadConfig(
  env: Record<string, string | undefined>,
  opts: { dryRun: boolean },
): WatcherConfig {
  const rpcUrl = required(env, "RPC_URL");
  const coverAddress = asAddress(required(env, "COVER_ADDRESS"), "COVER_ADDRESS");

  let privateKey: Hex | undefined;
  const pk = env.PRIVATE_KEY;
  if (pk && pk !== "") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("Invalid PRIVATE_KEY format");
    privateKey = pk as Hex;
  }
  if (!opts.dryRun && !privateKey) {
    throw new Error("PRIVATE_KEY is required unless running with --dry-run");
  }

  const dropThresholdBps = intEnv(env, "DROP_THRESHOLD_BPS", 3000, 1);
  // Per-target value source. KIND/PEG_WEI/DEPEG_BAND_BPS are index-aligned with TARGETS;
  // missing entries default a target to the tvl kind (today's behavior).
  const addrs = required(env, "TARGETS").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const kinds = csv(env.TARGETS_KIND);
  const pegs = csv(env.PEG_WEI);
  const bands = csv(env.DEPEG_BAND_BPS);

  const targets: TargetConfig[] = addrs.map((addr, i) => {
    const address = asAddress(addr, "target");
    const kindRaw = kinds[i] ?? "";
    if (kindRaw !== "" && kindRaw !== "tvl" && kindRaw !== "price") {
      throw new Error(`Invalid TARGETS_KIND[${i}]: ${kindRaw}`);
    }
    const kind: TargetKind = kindRaw === "price" ? "price" : "tvl";
    if (kind === "price") {
      return {
        address,
        kind,
        dropThresholdBps,
        pegWei: bigintStr(pegs[i], `PEG_WEI[${i}]`) ?? 10n ** 18n,
        depegBandBps: intStr(bands[i], `DEPEG_BAND_BPS[${i}]`, 1) ?? 200,
      };
    }
    return { address, kind, dropThresholdBps };
  });

  if (targets.length === 0) throw new Error("No TARGETS configured");

  return {
    rpcUrl,
    coverAddress,
    privateKey,
    pollIntervalMs: intEnv(env, "POLL_INTERVAL_MS", 5000, 1),
    windowSeconds: intEnv(env, "WINDOW_SECONDS", 120, 1),
    cooldownMs: intEnv(env, "COOLDOWN_MS", 60000, 0),
    // Periodic AI risk-keeper: default OFF (0) so the watcher never auto-spends STT.
    riskAssessIntervalMs: intEnv(env, "RISK_ASSESS_INTERVAL_MS", 0, 0),
    riskAssessMinGapMs: intEnv(env, "RISK_ASSESS_MIN_GAP_MS", 300000, 0),
    dryRun: opts.dryRun,
    targets,
  };
}
