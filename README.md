<p align="center">
  <img src="web/app/public/favicon.svg" width="84" alt="Aegis" />
</p>

# Aegis — autonomous AI-consensus parametric cover

**A two-sided DeFi insurance marketplace on Somnia, where an on-chain AI validator consensus
adjudicates claims and prices risk — no human in the loop.** Built for the Encode × Somnia Agentathon.

**▶ Live demo:** https://aegis-alpha-nine.vercel.app — reads Somnia Shannon live, no wallet needed to look around.
**▶ Demo video:** https://youtu.be/0IZKuDRkmLE

A watcher detects a covered protocol getting drained (or a stablecoin breaking its peg), and
**autonomously** asks Somnia's native AI agents for a verdict. Five validators (Qwen3-30B) each
score the evidence 0–100; the oracle takes the **median**; if it clears the threshold the cover
settles and the policyholder can claim — start to finish without anyone pressing a button.

---

## Why it's interesting

- **Agent-first, genuinely autonomous.** The decision to pay a claim is made by an AI validator
  committee on-chain, not by a multisig or a governance vote. The off-chain watcher only *triggers*
  the check (anyone can — `requestCheck` is permissionless); the verdict and the payout are on-chain.
- **The AI gate is what makes decentralized underwriting viable.** Anyone can be a liquidity
  provider and underwrite cover, earning premiums and bearing payouts — because claims are settled
  objectively by consensus, not by per-claim human voting (the bottleneck in Nexus-style mutuals).
- **Hybrid settlement kills the moral-hazard hole.** The AI decides *whether* an event happened
  (the trigger); a deterministic on-chain loss-calc decides *how much* —
  `min(sumInsured, positionAtPurchase − positionNow) × 90%`. You can never collect more than you lost.
- **Redeploy-proof core.** The core was deployed once. New perils are a stored prompt
  (`setSystemPrompt`), new protocols are a registry entry (`registerTarget`) — neither needs another
  deployment. A depeg peril was added, and its prompt tuned live (median 50 → 95), with zero redeploys.

## How it works

```
 watcher (off-chain)                AegisCover (on-chain)            ConsensusOracle → Somnia agents
 ───────────────────                ─────────────────────            ──────────────────────────────
 polls each target's value          registry of covered targets      per-peril system prompts in storage
 (TVL or price vs peg)              + peril routing                   requestVerdictFor(qid, evidence, peril)
        │ drop / depeg detected            │                                  │
        └─ requestCheck(target, evidence) ─┤── oracle.requestVerdictFor ──────┤── 5 validators score 0–100
                                           │                                  │── median ≥ 70 ? confirmed
            LP underwriting vault          │◀──────── onVerdict(score) ───────┘
            (shares · NAV · capacity)      │
            deterministic loss-calc  ──────┴─ payout credited → policyholder claim()
```

- **`ConsensusOracle`** — a generic AI-consensus primitive. Sends evidence + a system prompt to
  Somnia's native `IAgentRequester` (Threshold mode, 5 validators), reconciles the returned scores by
  median, reports a boolean verdict. System prompts live in storage keyed by peril (`EXPLOIT` /
  `DEPEG` / `RISK` …), so adding/tuning a peril is a transaction, not a deploy.
- **`AegisCover`** — the marketplace. A **registry** of covered protocols (each with an adapter +
  peril), variable agent-priced policies, the **hybrid settlement** loss-calc, and an **LP
  underwriting vault**: LPs `deposit()` for pool shares priced against NAV, premiums accrue to share
  value, payouts socialize across shares, and a capacity/solvency invariant (`freeAssets ≥
  lockedCapacity`) keeps the pool from over-selling cover or letting LPs withdraw collateral out from
  under active policies. Inflation/donation attack mitigated with a virtual offset.
- **Watcher** (TS/viem) — monitors each target by its kind (`tvl` = native balance drop, `price` =
  depeg below peg band), builds a deterministic evidence packet, and fires `requestCheck` itself. A
  periodic risk-keeper re-prices premiums by firing `requestRiskAssessment` when the cached score
  goes stale. Fully autonomous; no human trigger.
- **Frontend** (React + Vite + viem) — **Dashboard** (registry marketplace + pool health),
  **Guardian** (the consensus centerpiece: validator pentagon, median-vs-threshold, evidence,
  settlement), **Policies** (buy cover, demand side), **Underwrite** (provide capital, supply side),
  **Activity** (event feed).

## Live on Somnia Shannon (chain 50312)

| Contract | Address |
|---|---|
| ConsensusOracle (prompts-in-storage) | `0xda57E8B08aAbC6eb97Ef781b6D56E9192EAEdC26` |
| AegisCover (registry + LP vault) | `0x47824E585F7eCd4dD6574800625570ba9642FaB2` |
| Native agent platform / agentId | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` / `12847293847561029384` |

Demo targets (`DrainableVault`, an exploit target with a real reentrancy bug — the canonical The-DAO
class, drained in one transaction by an attacker contract; `MockStable`, a depeg target) are re-armed
fresh per demo via `contracts/rearm.sh`.

## Evaluate it (for judges)

No wallet or install is needed to *see it live*; a Shannon wallet to *interact*; the full autonomous
claim cycle is in the demo video (and reproducible end-to-end locally).

**1 — See it live (read-only, no install).** Open **https://aegis-alpha-nine.vercel.app** (or run it
locally: `cd web/app && npm install && npm run dev`). The frontend reads Somnia Shannon directly, so the
**Dashboard** shows the real on-chain board (7 covered protocols) — each with its live value, AI risk
score, and AI-priced premium — and **Claims** shows the validator pentagon with the median-vs-threshold
consensus view.

**2 — Interact (needs test STT).** Add Somnia Shannon to MetaMask (chain `50312`, RPC
`https://api.infra.testnet.somnia.network`, explorer `https://shannon-explorer.somnia.network`) and
fund a wallet from the Somnia testnet faucet (see https://docs.somnia.network/developer/network-info).
Then **buy cover** (My Cover) and **provide capital** (Earn) against the live pool.

**3 — See the autonomous claim cycle.** Detection → 5-validator AI vote → on-chain settle → payout,
with no human in the loop. On the public deployment the *exploit trigger* is owner-gated (so nobody can
grief the live demo). To see it end-to-end either:
- **watch the demo video** (linked in the submission), or
- **reproduce it yourself** — deploy your own stack (then you're the owner) per **Run it** below
  (`deploy-core.sh` + `deploy-board.sh`), run the watcher, and drain the `DrainableVault` from the
  attacker contract; the watcher detects it, consensus fires, the policy settles, and you claim.

**Verify it's real, not mocked:**
- Every contract and transaction is on the public explorer — open the addresses above on
  `shannon-explorer.somnia.network` and read the oracle's `ValidatorScores` / `VerdictFinalized` events
  (the actual per-validator AI scores and the median verdict).
- The AI is a real Somnia native agent:
  https://agents.testnet.somnia.network/agent/12847293847561029384.
- Two contrasting live runs show the AI genuinely discriminates: a 100%-drain exploit → median **100**
  → paid out; a benign 2% dip → median **50** → no payout. The 70 threshold cleanly separates them.
- Test suites: `forge test` (94, in `contracts/`); `npm test` in `watcher/` (47) and `web/app/` (17).

## Run it

**Contracts** (Foundry):
```bash
cd contracts && forge test          # 94 tests
# deploy a fresh core (oracle + cover + LP vault); needs a funded key in contracts/.env:
bash deploy-core.sh
# then deploy the live board of covered targets (exploit, depeg, bridge, …):
COVER=<printed> ORACLE=<printed> bash deploy-board.sh
```

**Watcher** (Node ≥ 20, TS/viem):
```bash
cd watcher && npm install
cp .env.example .env   # set COVER_ADDRESS, TARGETS, TARGETS_KIND, PRIVATE_KEY (owner)
npm test               # 47 tests
npm run dev            # live; or npm run dev -- --dry-run to rehearse without firing
```

**Frontend** (React + Vite):
```bash
cd web/app && npm install
npm run dev            # reads live Shannon by default; MetaMask on chain 50312 for writes
npm test               # 17 tests
```

## Demo flow

1. **Buy cover** (Policies) on a listed protocol — premium is AI-priced from its cached risk score.
2. **Underwrite** (Underwrite tab) — deposit STT into the pool for shares; you now earn premiums and
   back payouts.
3. **Trigger an event** — the exploit (an attacker contract reentrancy-drains the vault) or the depeg
   (`setPrice` breaks the peg). In production the watcher detects the real event; here one owner-only
   button stages it.
4. **Watch it settle itself** — the watcher fires `requestCheck`, the validator pentagon lights up,
   consensus confirms, the policy settles, and the LP's NAV drops by the socialized loss.
5. **Claim** — the policyholder pulls their payout.

## Repo layout

- `contracts/` — Foundry: `ConsensusOracle`, `AegisCover`, `AgentPrompt` (peril prompts), mocks,
  deploy scripts.
- `watcher/` — TS/viem off-chain monitor + risk-keeper.
- `web/app/` — React + Vite + viem frontend.

> Testnet project: keys live only in gitignored `.env` files; addresses above are Somnia Shannon
> testnet. Built for the Encode × Somnia Agentathon (submission 2026-06-10).
