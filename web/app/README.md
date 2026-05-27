# Aegis — Autonomous AI-consensus on-chain cover (Somnia Agentathon demo)

Aegis lets users buy cover for DeFi protocols and settles claims autonomously via a 5-validator AI consensus oracle deployed on Somnia Shannon (chain 50312).

## Run

```bash
cd web/app
npm install
npm run dev
```

Open the URL printed by Vite (default http://localhost:5173).

### Build

```bash
npm run build   # zero TS errors expected
npm run preview # serve the dist/ bundle
```

### Tests

```bash
npx vitest run  # ~17 unit tests (formatters, loss-calc, premium, evidence, committee)
```

## Environment

The `.env.example` file has all defaults pointing at live Shannon — no `.env` required for read-only browsing. Copy it if you want to override:

```
VITE_RPC_URL=https://api.infra.testnet.somnia.network
VITE_ORACLE=0xcF064aAC45Aa3Ec9d2eD0fA706fb5B549c362cda   # ConsensusOracle v2.1
VITE_COVER=0xbd9668F62B2e5b011191c4C9Ef8D0b16606b1796    # AegisCover v2 (#4-fixed)
VITE_VAULT=0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1   # MockVault
VITE_ADAPTER=0xbb5c05099A2d2Ae94c069f3fEE52B49DE1Af6C78 # MockVaultAdapter
```

**Read-only browsing** (Dashboard, Activity) works without a wallet — live chain data is fetched via the public RPC.

**On-chain writes** (buy cover, run consensus, claim, demo deposit/exploit) require MetaMask with Somnia Shannon testnet configured and some STT. The app prompts to add the chain automatically on first connect.

Shannon faucet: https://testnet.somnia.network

## Deployed contracts (Somnia Shannon · chain 50312)

| Contract | Address |
|---|---|
| ConsensusOracle v2.1 | `0xcF064aAC45Aa3Ec9d2eD0fA706fb5B549c362cda` |
| AegisCover v2 (#4-fixed) | `0xbd9668F62B2e5b011191c4C9Ef8D0b16606b1796` |
| MockVault | `0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1` |
| MockVaultAdapter | `0xbb5c05099A2d2Ae94c069f3fEE52B49DE1Af6C78` |

Explorer: https://shannon-explorer.somnia.network

## Gas note

Somnia Shannon costs ~10–15x viem's estimate. All writes use explicit gas overrides:

- `deposit` / `buyPolicy` / `exploit`: 3 000 000
- `claim`: 2 000 000
- `requestCheck` / `requestRiskAssessment`: 12 000 000

## Deployed-bytecode note

The live AegisCover `0xbd96…1796` is the `main` bytecode (includes the #4 over-insurance fix). By design the frontend never calls `coverByBuyerTarget` — cover caps use `MockVaultAdapter.positionOf(account)` instead. If contracts are re-deployed, only `src/chain/config.ts` needs updating.

## Demo script (recording)

### 1 — Dashboard (`#/`)
Live MockVault TVL + sparkline + risk score → rate. Demo cards (DeepLend, OrbitDEX, NovaStake, ZenVault) show the product vision.

### 2 — Policies (`#/policies`)
Click **Buy cover** on MockVault. The AI-priced quote is read from the cached risk score (instant). Set sum insured, confirm → `buyPolicy` on-chain (3 M gas). The policy appears in My Policies.

### 3 — Guardian (`#/guardian`) — the centrepiece
1. Connect as the deployer wallet (`0xc84C24F751c686568A907650FD59b1a3AC1a5E67`).
2. The **DEMO CONTROLS** strip appears at the top. Click it to expand.
3. **① Deposit 0.1 STT** — funds MockVault.
4. **② Exploit (drain TVL→0)** — simulates the hack; TVL card updates in real time.
5. Click **Run consensus** — `requestCheck` fires (12 M gas), 5 Somnia agents deliberate.
6. Watch the pentagon animate (~1–2 min, real on-chain). Consensus arrives as `VerdictReceived`.
7. `CONFIRMED · median ≥ 70` → loss-calc breakdown fills in → **CLAIM 0.09 STT** button activates.
8. Click **CLAIM** — `claim()` on-chain (2 M gas) — payout credited.

### 4 — Activity (`#/activity`)
All four real tx hashes are clickable Shannon explorer links — proof every action was on-chain.

## Architecture notes

- React 18 + Vite 5 + TypeScript + viem 2.x + react-router-dom 6 (HashRouter — works from any static host).
- No Tailwind — design tokens ported verbatim from the locked `dotgrid-dark` mockup (`src/styles/tokens.css`).
- Live reads: `useChainReads` polls the chain every 8 s; `useGuardian` watches `VerdictReceived` events via `publicClient.watchContractEvent`.
- No Multicall3 on Shannon: all batched reads use `deployless: true` in `publicClient.multicall`.
- Demo data (non-live cards, ZenVault depeg event, seed Activity rows) lives in `src/data/demo.ts` and is clearly tagged `demo` in the code.
