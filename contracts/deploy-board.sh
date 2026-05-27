#!/usr/bin/env bash
# Deploy a fresh, coherent 7-protocol monitoring board on the marketplace cover — one real on-chain
# target per peril, all healthy + assessed, so the Dashboard shows live data + charts + AI risk for
# every card. Perils are pure data (a prompt key), so this is config, not a core redeploy.
#
#   Exploit  ×2 : VaultGuard (healthy)            + DrainableVault (reentrancy, drained live for video)
#   Depeg       : MockStable  (price vs peg)
#   Bridge      : OmniBridge  (tvl)
#   Slashing    : NovaStake   (tvl)
#   Oracle      : PriceWire   (price)
#   Governance  : AevumDAO    (tvl)
#
# Reuses existing mock types (DemoVault=tvl, MockStable=price, DrainableVault+ReentrancyAttacker for
# the live drain). Fires all risk assessments up front, then polls — far faster than sequential.
# Deactivates the prior settled targets so the board is exactly these seven.
#
#   COVER=0x.. ORACLE=0x.. bash deploy-board.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:?set ORACLE}"
COVER="${COVER:?set COVER}"
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"
CREATE_GAS=30000000; CALL_GAS=12000000; SEND_GAS=8000000
OUT=deploy-board.out
: > "$OUT"
PK=(--rpc-url "$RPC" --private-key "$PRIVATE_KEY")
ME=$(cast wallet address --private-key "$PRIVATE_KEY")
echo ">> owner: $ME"
echo ">> oracle balance: $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"

# Cover is already an authorized consumer (set at marketplace launch). The live oracle predates the
# named BRIDGE/SLASHING/ORACLE/GOVERNANCE_KEY getters, so compute keys as keccak256(NAME) — verified
# to match the on-chain EXPLOIT/DEPEG keys, and the prompts are seeded under exactly these keys.
EXPLOIT_KEY=$(cast keccak EXPLOIT)
DEPEG_KEY=$(cast keccak DEPEG)
BRIDGE_KEY=$(cast keccak BRIDGE)
SLASHING_KEY=$(cast keccak SLASHING)
ORACLE_KEY=$(cast keccak ORACLE)
GOV_KEY=$(cast keccak GOVERNANCE)

ASSESS_T=(); ASSESS_N=()

# provision <kind: tvl|price> <name> <perilKey> <seedWei> <facts-json>
provision() {
  local kind="$1" name="$2" key="$3" seed="$4" facts="$5" src seedfn
  if [ "$kind" = "price" ]; then src="src/mocks/MockStable.sol:MockStable"; seedfn="deposit()"
  else src="src/mocks/DemoVault.sol:DemoVault"; seedfn="stake()"; fi
  echo ">> [$name] deploy ($kind)..."
  local tgt adp
  tgt=$(forge create "$src" "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast | grep "Deployed to:" | awk '{print $3}')
  adp=$(forge create "src/mocks/MockVaultAdapter.sol:MockVaultAdapter" "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast --constructor-args "$tgt" | grep "Deployed to:" | awk '{print $3}')
  echo "   target=$tgt  adapter=$adp"
  cast send "$tgt" "$seedfn" --value "$seed" "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null
  cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$tgt" "$adp" "$key" "$name" "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null
  cast send "$COVER" "requestRiskAssessment(address,bytes)" "$tgt" "$(cast from-utf8 "$facts")" "${PK[@]}" --gas-limit "$CALL_GAS" >/dev/null
  ASSESS_T+=("$tgt"); ASSESS_N+=("$name")
  echo "$name $kind target=$tgt adapter=$adp" >> "$OUT"
}

# The draining exploit target gets a reentrancy attacker for the live hack.
provision_drain() {
  local seed="$1" facts="$2"
  echo ">> [DrainableVault] deploy (reentrancy exploit target)..."
  local tgt adp atk
  tgt=$(forge create "src/mocks/DrainableVault.sol:DrainableVault" "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast | grep "Deployed to:" | awk '{print $3}')
  adp=$(forge create "src/mocks/MockVaultAdapter.sol:MockVaultAdapter" "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast --constructor-args "$tgt" | grep "Deployed to:" | awk '{print $3}')
  atk=$(forge create "src/mocks/ReentrancyAttacker.sol:ReentrancyAttacker" "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast --constructor-args "$tgt" | grep "Deployed to:" | awk '{print $3}')
  echo "   target=$tgt  adapter=$adp  attacker=$atk"
  cast send "$tgt" "deposit()" --value "$seed" "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null
  cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$tgt" "$adp" "$EXPLOIT_KEY" "DrainableVault" "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null
  cast send "$COVER" "requestRiskAssessment(address,bytes)" "$tgt" "$(cast from-utf8 "$facts")" "${PK[@]}" --gas-limit "$CALL_GAS" >/dev/null
  ASSESS_T+=("$tgt"); ASSESS_N+=("DrainableVault")
  DRAIN_VAULT="$tgt"; DRAIN_ADAPTER="$adp"; DRAIN_ATTACKER="$atk"
  echo "DrainableVault exploit target=$tgt adapter=$adp attacker=$atk" >> "$OUT"
}

# ── Provision the seven (present-tense factual facts; forward-looking framing makes Qwen collapse) ──
provision tvl   "VaultGuard" "$EXPLOIT_KEY" 500000000000000000 \
  '{"protocol":"an audited ETH staking vault","audited":true,"numberOfSecurityAudits":2,"ageInDays":420,"priorSecurityIncidents":0,"adminControl":"privileged functions are behind a 48h timelock and a 4-of-7 multisig","withdrawPath":"checks-effects-interactions with a reentrancy guard","liquidity":"deep"}'

provision_drain 400000000000000000 \
  '{"protocol":"a DeFi yield vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"the withdraw path sends funds before updating balances (reentrancy-prone) and has no reentrancy guard","oracleDependency":"none","userDepositsUSD":50000,"liquidity":"thin"}'

provision price "MockStable" "$DEPEG_KEY" 400000000000000000 \
  '{"protocol":"a price-pegged stablecoin pegged to 1.0","audited":false,"numberOfSecurityAudits":0,"ageInDays":2,"collateralization":"partial and volatile","priorDepegEvents":1,"adminControl":"a single admin key can change the price feed with no timelock","liquidity":"thin bid-side depth"}'

provision tvl   "OmniBridge" "$BRIDGE_KEY" 600000000000000000 \
  '{"protocol":"a cross-chain token bridge that locks collateral on one chain and mints on another","audited":true,"numberOfSecurityAudits":1,"ageInDays":120,"lockedValueUSD":1500000,"trustModel":"an external 7-of-12 validator set signs withdrawals","adminControl":"the validator set can be rotated by a multisig with no timelock","note":"bridges hold large pooled collateral and are the most frequently exploited DeFi primitive"}'

provision tvl   "NovaStake" "$SLASHING_KEY" 450000000000000000 \
  '{"protocol":"a liquid staking pool that delegates to external validators","audited":true,"numberOfSecurityAudits":2,"ageInDays":300,"slashingHistory":"minor slashing penalties occurred in the past year","validatorConcentration":"the top 3 operators control 40 percent of stake","adminControl":"operator set is DAO-governed with a timelock"}'

provision price "PriceWire" "$ORACLE_KEY" 300000000000000000 \
  '{"protocol":"an on-chain price oracle feed consumed by lending markets","audited":false,"numberOfSecurityAudits":0,"ageInDays":60,"sources":"two DEX TWAPs on low-liquidity pairs","manipulationResistance":"low; the pairs are shallow and manipulable within a block","updateFrequency":"on-demand","adminControl":"a single updater key with no timelock"}'

provision tvl   "AevumDAO" "$GOV_KEY" 550000000000000000 \
  '{"protocol":"a DAO treasury controlled by on-chain governance","audited":true,"numberOfSecurityAudits":1,"ageInDays":200,"treasuryUSD":3000000,"governance":"4 percent quorum with a 2-day timelock on execution","priorIncidents":0,"adminControl":"on-chain governance proposals gated by the timelock"}'

echo ""
echo ">> All 7 deployed + registered + risk requested. Polling for AI risk scores..."
DEADLINE=$((SECONDS + 900))
PENDING=1
while [ "$PENDING" -gt 0 ]; do
  PENDING=0; LINE=""
  for i in "${!ASSESS_T[@]}"; do
    if [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "${ASSESS_T[$i]}" --rpc-url "$RPC" 2>/dev/null)" = "true" ]; then
      SC=$(cast call "$COVER" 'riskScore(address)(uint256)' "${ASSESS_T[$i]}" --rpc-url "$RPC")
      LINE+="${ASSESS_N[$i]}=$SC "
    else
      PENDING=$((PENDING+1)); LINE+="${ASSESS_N[$i]}=… "
    fi
  done
  echo "   [$PENDING pending] $LINE"
  if [ "$PENDING" -eq 0 ]; then break; fi
  if [ "$SECONDS" -ge "$DEADLINE" ]; then echo "   TIMED OUT (15m) — $PENDING still pending; re-poll later." >&2; break; fi
  sleep 12
done

echo ""
echo ">> Deactivating the prior (settled) targets so the board is exactly the new seven..."
for OLD in 0x195F2aeC730f9b7DD47aC19930aa891A1dFd6FFd 0x1C1593F4BB196010Cf97Dcfc27fD5D4E6bc7bB80 0x4B2f15360F2CA318DaE456692300002672DC93B6; do
  cast send "$COVER" "setTargetActive(address,bool)" "$OLD" false "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null && echo "   deactivated $OLD"
done

echo ""
echo "=== BOARD ARMED ==="
echo "oracle balance now: $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"
echo "listed count:       $(cast call "$COVER" 'listedTargetsCount()(uint256)' --rpc-url "$RPC")"
echo "--- addresses (also in $OUT) ---"
cat "$OUT"
echo ""
echo ">> config.ts repoint (the draining exploit + depeg are the Guardian/video targets):"
echo "   vault=$DRAIN_VAULT  adapter=$DRAIN_ADAPTER  attacker=$DRAIN_ATTACKER"
echo "   (MockStable = the depeg 'stable'/'stableAdapter' — see $OUT)"
