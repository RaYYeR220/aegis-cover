import type { Address } from "viem";

// The single live, on-chain protocol (everything else on the dashboard is a static demo card).
// Autonomous-product phase: a staking vault with a real access-control vuln (DemoVault).
export const LIVE_PROTOCOL = "DrainableVault" as const;
// The second live target: a pegged asset (MockStable) carrying a Depeg peril. Surfaces only once
// ADDR.stable is configured (post-redeploy) — see chain/config.isAddrSet.
export const LIVE_DEPEG_PROTOCOL = "MockStable" as const;
export const PEG_WEI = 10n ** 18n; // 1e18 == $1.00 peg

export type CoverTypeName = "Exploit" | "Depeg" | "Bridge" | "Slashing" | "Oracle" | "Governance";

// The peril catalog. Perils are DATA on-chain (a system prompt keyed by name), so the catalog is the
// honest story: Exploit + Depeg are live; the rest are seeded prompt presets that activate the moment
// a protocol is listed under them — no contract redeploy. This replaces the old fake "demo protocols".
export interface PerilDef {
  name: CoverTypeName;
  key: string; // matches ConsensusOracle.<NAME>_KEY = keccak256(NAME)
  blurb: string;
  live: boolean; // has a live target in this demo
}
export const PERILS: PerilDef[] = [
  { name: "Exploit", key: "EXPLOIT", blurb: "Funds drained by a contract exploit — reentrancy, access-control.", live: true },
  { name: "Depeg", key: "DEPEG", blurb: "A pegged asset trading materially below its peg.", live: true },
  { name: "Bridge", key: "BRIDGE", blurb: "A cross-chain bridge compromised — collateral unbacked or drained.", live: false },
  { name: "Slashing", key: "SLASHING", blurb: "Validator stake cut by a protocol slashing penalty.", live: false },
  { name: "Oracle", key: "ORACLE", blurb: "A price feed stale, frozen, or manipulated off the true price.", live: false },
  { name: "Governance", key: "GOVERNANCE", blurb: "A hostile governance action seizing treasury funds.", live: false },
];
export interface DemoProtocol {
  name: string; tag: "demo"; coverType: CoverTypeName;
  primaryMetric: string; metricLabel: string; delta24h: string; status: string;
  riskLabel: string; rate: number; rateLabel: string;
  yourCover?: string; lastCheck: string; capacity: number; capacityPct: number;
  position: number; // for buy-flow cap
}

// Per-protocol buy-flow data (mockup PROTOCOL_DATA, lines 2916–2922)
export const PROTOCOL_DATA: Record<string, { position: number; riskLabel: string; rate: number; rateLabel: string; capacity: number; capacityPct: number }> = {
  // Live target. position/riskLabel here are only fallbacks — the live card reads the on-chain
  // TVL, risk score and quoted premium directly.
  [LIVE_PROTOCOL]: { position: 0.4, riskLabel: "High · 75/100", rate: 0.10, rateLabel: "10%", capacity: 8200, capacityPct: 68 },
  DeepLend: { position: 12400, riskLabel: "Medium · 55/100", rate: 0.06, rateLabel: "6%", capacity: 42000, capacityPct: 44 },
  OrbitDEX: { position: 38100, riskLabel: "Low · 32/100", rate: 0.03, rateLabel: "3%", capacity: 61000, capacityPct: 31 },
  NovaStake: { position: 9200, riskLabel: "Medium · 48/100", rate: 0.05, rateLabel: "5%", capacity: 18000, capacityPct: 52 },
  ZenVault: { position: 20000, riskLabel: "High · 74/100", rate: 0.09, rateLabel: "9%", capacity: 11000, capacityPct: 73 },
};

// Demo dashboard cards (NON-live; the live DemoVault card is rendered separately, not in this list).
// Cover-type assignment per spec §6: DeepLend/OrbitDEX Exploit, NovaStake Slashing, ZenVault Depeg.
export const DEMO_PROTOCOLS: DemoProtocol[] = [
  { name: "DeepLend", tag: "demo", coverType: "Exploit", primaryMetric: "1.24M STT", metricLabel: "TVL", delta24h: "+0.4%", status: "Healthy", riskLabel: "Medium · 55/100", rate: 0.06, rateLabel: "6%", lastCheck: "12s ago", capacity: 42000, capacityPct: 44, position: 12400 },
  { name: "OrbitDEX", tag: "demo", coverType: "Exploit", primaryMetric: "3.81M STT", metricLabel: "TVL", delta24h: "+1.2%", status: "Healthy", riskLabel: "Low · 32/100", rate: 0.03, rateLabel: "3%", yourCover: "5,000 STT · Active", lastCheck: "8s ago", capacity: 61000, capacityPct: 31, position: 38100 },
  { name: "NovaStake", tag: "demo", coverType: "Slashing", primaryMetric: "920k STT", metricLabel: "Staked", delta24h: "0.0%", status: "Healthy", riskLabel: "Medium · 48/100", rate: 0.05, rateLabel: "5%", lastCheck: "20s ago", capacity: 18000, capacityPct: 52, position: 9200 },
  { name: "ZenVault", tag: "demo", coverType: "Depeg", primaryMetric: "$0.998", metricLabel: "Price vs peg", delta24h: "−0.2%", status: "Elevated", riskLabel: "High · 74/100", rate: 0.09, rateLabel: "9%", yourCover: "2,000 STT · Active", lastCheck: "5s ago", capacity: 11000, capacityPct: 73, position: 20000 },
];

// Validator labels for the pentagon when live committee fetch is unavailable (mockup lines 2666–2672)
export const VALIDATOR_LABELS = ["0x7A3f…b21c", "0x4eD9…90aF", "0x12C8…ee01", "0xBb62…3399", "0x037B…6776"];
export const NODE_RATIONALES = [
  { score: 100, rationale: '"100% TVL drain in 38s with a single attacker address; unambiguous exploit."' },
  { score: 100, rationale: '"Total drain + no governance action; matches exploit pattern."' },
  { score: 95, rationale: '"Severe drain confirmed; minor uncertainty on flash-loan attribution."' },
  { score: 100, rationale: '"Full loss of funds; web2 alerts corroborate."' },
  { score: 90, rationale: '"Clear drain; slight caution pending post-mortem."' },
];

// Demo Guardian events (the ZenVault depeg is demo-only; DemoVault events are produced live).
// Mockup EVENTS lines 2501–2564 — kept for the selector's non-live entries.
export interface DemoEvent {
  id: string; protocol: string; type: string; coverType: CoverTypeName;
  badge: string; confirmed: boolean; median: number; timer: string; elapsed: string;
  verdict: string; evidence: string[]; confirmedText: string;
}
// No scripted demo events — the Guardian shows only the real live targets (exploit + depeg).
export const DEMO_EVENTS: DemoEvent[] = [];

// Demo policies for the connected wallet (besides the live DemoVault one). Mockup §3.
export interface DemoPolicy { protocol: string; coverType: CoverTypeName; coverage: string; premium: string; duration: string; status: string; }
export const DEMO_POLICIES: DemoPolicy[] = [
  { protocol: "OrbitDEX", coverType: "Exploit", coverage: "5,000 STT", premium: "~37 STT", duration: "90d", status: "Active" },
  { protocol: "ZenVault", coverType: "Depeg", coverage: "2,000 STT", premium: "~44 STT", duration: "90d", status: "Active · Elevated" },
];

// Seed Activity rows (real reference runs + demo). Live events get prepended at runtime.
export interface ActivityItem { ts: string; type: CoverTypeName | "Policy" | "Claim"; label: string; value: string; tx?: string; }
// No seed rows — the feed shows real on-chain events only.
export const DEMO_ACTIVITY: ActivityItem[] = [];

export const DEMO_WALLET = "0xc84C24F751c686568A907650FD59b1a3AC1a5E67" as Address;
