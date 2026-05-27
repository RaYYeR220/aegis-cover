#!/usr/bin/env bash
# Deploy the REENTRANCY exploit target: DrainableVault (real interaction-before-effect bug) + a
# generic adapter + a ReentrancyAttacker contract, then registerTarget() it on the marketplace cover
# under the EXPLOIT peril. For the video: stake from a few real wallets, then drain from an attacker
# wallet live → the watcher detects TVL→0 and fires consensus → payout.
#
# Usage from contracts/ with a funded OWNER key in .env and the marketplace core's addresses:
#   COVER=0x..cover ORACLE=0x..oracle bash deploy-drainvault.sh
#   BUY=1 ... bash deploy-drainvault.sh    # also pre-buy a 0.1 Exploit policy
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:?set ORACLE (the marketplace core's oracle)}"
COVER="${COVER:?set COVER (the marketplace core's cover)}"
SEED_OTHERS_WEI="${SEED_OTHERS_WEI:-300000000000000000}"      # 0.3 STT — other stakers' funds
SEED_POSITION_WEI="${SEED_POSITION_WEI:-100000000000000000}"   # 0.1 STT — the policyholder's position
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CREATE_GAS=30000000
CALL_GAS=12000000

ME=$(cast wallet address --private-key "$PRIVATE_KEY")
echo ">> owner/holder: $ME"

echo ">> Deploying DrainableVault (real reentrancy bug: withdraw sends before updating balance)..."
VAULT=$(forge create src/mocks/DrainableVault.sol:DrainableVault \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  | grep "Deployed to:" | awk '{print $3}')
echo "   DrainableVault: $VAULT"

echo ">> Deploying the (generic) position adapter pointing at DrainableVault..."
ADAPTER=$(forge create src/mocks/MockVaultAdapter.sol:MockVaultAdapter \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$VAULT" | grep "Deployed to:" | awk '{print $3}')
echo "   Adapter: $ADAPTER"

echo ">> Deploying ReentrancyAttacker (anyone can — that's the point)..."
ATTACKER=$(forge create src/mocks/ReentrancyAttacker.sol:ReentrancyAttacker \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$VAULT" | grep "Deployed to:" | awk '{print $3}')
echo "   ReentrancyAttacker: $ATTACKER"

# Baseline TVL from the owner (models distinct stakers). For the video, ALSO stake from a couple of
# real funded wallets live: cast send $VAULT "deposit()" --value <amt> --private-key <stakerKey>.
echo ">> Seeding baseline TVL: deposit $SEED_OTHERS_WEI (others) + $SEED_POSITION_WEI (holder)..."
cast send "$VAULT" "deposit()" --value "$SEED_OTHERS_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
cast send "$VAULT" "deposit()" --value "$SEED_POSITION_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
echo "   TVL: $(cast balance "$VAULT" --rpc-url "$RPC" --ether) STT"

echo ">> Ensuring cover is an authorized oracle consumer (idempotent)..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

EXPLOIT_KEY=$(cast call "$COVER" 'EXPLOIT_KEY()(bytes32)' --rpc-url "$RPC")
echo ">> registerTarget(DrainableVault, adapter, EXPLOIT_KEY=$EXPLOIT_KEY)..."
cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$VAULT" "$ADAPTER" "$EXPLOIT_KEY" "DrainableVault" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

echo ">> Risk assessment for DrainableVault (async)..."
FACTS=$(cast from-utf8 '{"protocol":"a DeFi yield vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"withdraw path sends funds before updating balances (reentrancy-prone), no reentrancy guard","oracleDependency":"none","userDepositsUSD":50000,"liquidity":"thin"}')
cast send "$COVER" "requestRiskAssessment(address,bytes)" "$VAULT" "$FACTS" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

printf "   waiting for validators to return a risk score"
DEADLINE=$((SECONDS + 600))
until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$VAULT" --rpc-url "$RPC" 2>/dev/null)" = "true" ]; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "" >&2; echo "   TIMED OUT after 10m — assessment never landed (check oracle balance)." >&2; exit 1
  fi
  printf "."; sleep 10
done
echo " done."
SCORE=$(cast call "$COVER" 'riskScore(address)(uint256)' "$VAULT" --rpc-url "$RPC")
echo "   risk score: $SCORE"

if [ "${BUY:-0}" = "1" ]; then
  echo ">> Buying $SEED_POSITION_WEI Exploit cover (365d) at the quoted premium..."
  PREMIUM=$(cast call "$COVER" 'quotePremium(address,uint256,uint64)(uint256)' \
    "$VAULT" "$SEED_POSITION_WEI" 31536000 --rpc-url "$RPC"); PREMIUM=${PREMIUM%% *}
  cast send "$COVER" "buyPolicy(address,uint8,uint256,uint64)" "$VAULT" 0 "$SEED_POSITION_WEI" 31536000 \
    --value "$PREMIUM" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
else
  echo ">> BUY=0 → record the buy flow live."
fi

echo ""
echo "=== DRAINABLEVAULT ARMED (Exploit / reentrancy) ==="
echo "DrainableVault:     $VAULT"
echo "Adapter:            $ADAPTER"
echo "ReentrancyAttacker: $ATTACKER"
echo "riskScore:          $SCORE   TVL: $(cast balance "$VAULT" --rpc-url "$RPC" --ether) STT"
echo ""
echo ">> THE LIVE HACK (from an attacker wallet, draining the whole pool in one tx):"
echo "   cast send $ATTACKER 'attack()' --value <seedWei> --private-key <attackerKey> --gas-limit 8000000"
echo ">> NOW UPDATE:"
echo "   web/app/src/chain/config.ts   vault=$VAULT   adapter=$ADAPTER   (+ VITE_ATTACKER=$ATTACKER)"
echo "   watcher/.env  TARGETS=$VAULT,<mockstable>   TARGETS_KIND=tvl,price"
