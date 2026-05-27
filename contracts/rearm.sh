#!/usr/bin/env bash
# Re-arm for a recording take: deploy a FRESH, healthy DrainableVault (+ attacker), register it under
# EXPLOIT, seed TVL, deactivate the spent old one — and RE-ASSESS all active board targets so every
# "AI priced …" timestamp reads recent. Keeps the cover/LP/registry and the other dashboard cards.
#
#   COVER=0x.. ORACLE=0x.. bash rearm.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:?}"; COVER="${COVER:?}"
: "${PRIVATE_KEY:?}"
CREATE_GAS=30000000; CALL_GAS=12000000; SEND_GAS=8000000
TOPUP_ETH="${TOPUP_ETH:-4}"
OLD_DRAIN="${OLD_DRAIN:-0xd43db31fF41Fed52295d0760455aF6B02B505aAE}"
PK=(--rpc-url "$RPC" --private-key "$PRIVATE_KEY")
OUT=rearm.out; : > "$OUT"
EXPLOIT_KEY=$(cast keccak EXPLOIT)

echo ">> oracle balance before: $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"
echo ">> topping up oracle +${TOPUP_ETH} STT..."
cast send "$ORACLE" --value "${TOPUP_ETH}ether" "${PK[@]}" --gas-limit 60000 >/dev/null

echo ">> deploying FRESH DrainableVault + adapter + attacker..."
VAULT=$(forge create src/mocks/DrainableVault.sol:DrainableVault "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast | grep "Deployed to:" | awk '{print $3}')
ADAPTER=$(forge create src/mocks/MockVaultAdapter.sol:MockVaultAdapter "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast --constructor-args "$VAULT" | grep "Deployed to:" | awk '{print $3}')
ATTACKER=$(forge create src/mocks/ReentrancyAttacker.sol:ReentrancyAttacker "${PK[@]}" --gas-limit "$CREATE_GAS" --broadcast --constructor-args "$VAULT" | grep "Deployed to:" | awk '{print $3}')
echo "   vault=$VAULT adapter=$ADAPTER attacker=$ATTACKER"
echo "vault=$VAULT adapter=$ADAPTER attacker=$ATTACKER" >> "$OUT"

echo ">> seeding TVL 0.3 + 0.1 = 0.4 STT..."
cast send "$VAULT" "deposit()" --value 300000000000000000 "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null
cast send "$VAULT" "deposit()" --value 100000000000000000 "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null

echo ">> registerTarget(fresh DrainableVault, EXPLOIT)..."
cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$VAULT" "$ADAPTER" "$EXPLOIT_KEY" "DrainableVault" "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null

echo ">> deactivating the spent old DrainableVault ($OLD_DRAIN)..."
cast send "$COVER" "setTargetActive(address,bool)" "$OLD_DRAIN" false "${PK[@]}" --gas-limit "$SEND_GAS" >/dev/null || echo "   (already inactive)"

# Fire a risk assessment (refreshes score + riskAssessedAt = "AI priced just now").
assess() { # <target> <facts-json>
  cast send "$COVER" "requestRiskAssessment(address,bytes)" "$1" "$(cast from-utf8 "$2")" "${PK[@]}" --gas-limit "$CALL_GAS" >/dev/null
  echo "   assess fired: $1"
}

echo ">> assessing the fresh DrainableVault..."
assess "$VAULT" '{"protocol":"a DeFi yield vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"the withdraw path sends funds before updating balances (reentrancy-prone) and has no reentrancy guard","oracleDependency":"none","userDepositsUSD":50000,"liquidity":"thin"}'

echo ">> re-assessing the other active board targets (refreshes their AI-priced timestamps)..."
assess 0xA4D7B17FA299F7D6a0977912f7fCB27D1D799604 '{"protocol":"an audited ETH staking vault","audited":true,"numberOfSecurityAudits":2,"ageInDays":425,"priorSecurityIncidents":0,"adminControl":"privileged functions are behind a 48h timelock and a 4-of-7 multisig","withdrawPath":"checks-effects-interactions with a reentrancy guard","liquidity":"deep"}'
assess 0x67A28eabb4E64BFe4EE35e5cb18B25E0431B400E '{"protocol":"a price-pegged stablecoin pegged to 1.0","audited":false,"numberOfSecurityAudits":0,"ageInDays":2,"collateralization":"partial and volatile","priorDepegEvents":1,"adminControl":"a single admin key can change the price feed with no timelock","liquidity":"thin bid-side depth"}'
assess 0x557CC756Cf166F9FeC90F7eE8027877B3ef165dd '{"protocol":"a cross-chain token bridge that locks collateral on one chain and mints on another","audited":true,"numberOfSecurityAudits":1,"ageInDays":120,"lockedValueUSD":1500000,"trustModel":"an external 7-of-12 validator set signs withdrawals","adminControl":"the validator set can be rotated by a multisig with no timelock","note":"bridges hold large pooled collateral and are the most frequently exploited DeFi primitive"}'
assess 0x4d55c3A46E281b8be115bA207936a27b1FA5A7C4 '{"protocol":"a liquid staking pool that delegates to external validators","audited":true,"numberOfSecurityAudits":2,"ageInDays":300,"slashingHistory":"minor slashing penalties occurred in the past year","validatorConcentration":"the top 3 operators control 40 percent of stake","adminControl":"operator set is DAO-governed with a timelock"}'
assess 0xd77500d1cB6B9703D37Fb38891703020DB0eE4e6 '{"protocol":"an on-chain price oracle feed consumed by lending markets","audited":false,"numberOfSecurityAudits":0,"ageInDays":60,"sources":"two DEX TWAPs on low-liquidity pairs","manipulationResistance":"low; the pairs are shallow and manipulable within a block","updateFrequency":"on-demand","adminControl":"a single updater key with no timelock"}'
assess 0xe97cBb06ef29695ef4485a3e4872344653835aDd '{"protocol":"a DAO treasury controlled by on-chain governance","audited":true,"numberOfSecurityAudits":1,"ageInDays":200,"treasuryUSD":3000000,"governance":"4 percent quorum with a 2-day timelock on execution","priorIncidents":0,"adminControl":"on-chain governance proposals gated by the timelock"}'

echo ">> waiting for the fresh DrainableVault score (the others refresh in the background)..."
DEADLINE=$((SECONDS + 600))
until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$VAULT" --rpc-url "$RPC" 2>/dev/null)" = "true" ]; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then echo "   TIMED OUT (10m) — re-check later." >&2; break; fi
  printf "."; sleep 10
done
echo " done. score: $(cast call "$COVER" 'riskScore(address)(uint256)' "$VAULT" --rpc-url "$RPC")"

echo ""
echo "=== RE-ARMED ==="
echo "DrainableVault: $VAULT   TVL $(cast balance "$VAULT" --rpc-url "$RPC" --ether) STT   settled $(cast call "$COVER" 'targetSettled(address)(bool)' "$VAULT" --rpc-url "$RPC")"
echo "adapter:        $ADAPTER"
echo "attacker:       $ATTACKER"
echo "oracle balance: $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"
echo ""
echo ">> config.ts: vault=$VAULT  adapter=$ADAPTER  attacker(VITE_ATTACKER)=$ATTACKER"
echo ">> watcher/.env TARGETS first entry → $VAULT"
