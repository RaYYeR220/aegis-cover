# Aegis Watcher

Off-chain Guardian daemon. Monitors a target protocol's TVL, detects a candidate
exploit (sharp drop), and nudges `AegisCover.requestCheck(target, evidence)` so the
on-chain validator-consensus AI renders the verdict. **v2** also runs an optional
periodic **risk keeper** that refreshes each target's on-chain cached AI risk score
(the score the frontend's buy-quote reads).

Points at the live v2.1 Shannon deployment by default (see `.env.example`):
AegisCover `0xbd96…1796`, MockVault target `0xCdfb…13D1`.

## Setup

```bash
cd watcher
npm install
cp .env.example .env   # fill in RPC_URL, COVER_ADDRESS, TARGETS (and PRIVATE_KEY for live)
```

## Run

```bash
npm run dev -- --dry-run   # logs intended checks, sends nothing (no key needed)
npm run dev                # live: sends requestCheck txs (requires PRIVATE_KEY)
```

## Test

```bash
npm test          # vitest unit suite
npm run typecheck # tsc --noEmit
```

## How it works

`config` → `tvlMonitor` (TVL samples → delta/largest-drop bps) → `detector`
(cheap "ask the AI?" heuristic) → `evidence` (deterministic multi-signal JSON →
bytes) → `watcher` orchestrator → `loop`. The detector only decides whether to
*open a check*; the payout *verdict* is the on-chain consensus AI's job. Evidence is
canonical JSON (sorted keys) so every validator re-running the agent sees identical input.

## Risk keeper (v2, optional — OFF by default)

A second, slower periodic job. On its own cadence it reads `riskAssessedAt(target)` and,
when the cached score is older than `RISK_ASSESS_INTERVAL_MS`, builds present-tense risk
facts (`aegis-risk-facts/1`) and fires `AegisCover.requestRiskAssessment(target, facts)`.
The agent committee scores 0–100, the median is cached on-chain, and the frontend's
buy-quote reads that cache — so pricing is instant yet fully agent-set, off the user's path.

- **Disabled by default** (`RISK_ASSESS_INTERVAL_MS=0`). Enable with e.g. `21600000` (6h).
- **`requestRiskAssessment` is `onlyOwner`** → `PRIVATE_KEY` must be the cover owner/deployer.
- Each run **spends ~0.37 STT** of the oracle deposit — only enable intentionally.
- `RISK_ASSESS_MIN_GAP_MS` (default 5m) throttles re-fires while a verdict is pending.

## Somnia gas note

Consensus-triggering writes (`requestCheck`, `requestRiskAssessment`) invoke the native
`createAdvancedRequest` and need ~3.6M+ gas. Somnia under-estimates ~10–15× and such a tx
OOGs *silently* (the send still returns a hash / exits 0). The watcher pins an explicit
**12M** gas limit on both — do not remove it.
