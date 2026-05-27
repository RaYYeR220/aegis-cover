#!/usr/bin/env bash
# Deploy MockStable (the depeg live target) + a generic adapter, then registerTarget() it on the
# marketplace cover under the DEPEG peril. No core redeploy — a NEW peril+target is pure config.
#
# The watcher (price-mode) then monitors price() vs peg and auto-fires consensus on a depeg; the
# deterministic loss-calc credits the price-scaled loss. Only staged action: setPrice(0.9) (demo).
#
# Usage from contracts/ with a funded OWNER key in .env and the NEW core's addresses:
#   COVER=0x..newcover ORACLE=0x..neworacle bash deploy-mockstable.sh
#   BUY=1 ... bash deploy-mockstable.sh    # also pre-buy a depeg policy
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:?set ORACLE (the new core's oracle) — e.g. ORACLE=0x.. bash deploy-mockstable.sh}"
COVER="${COVER:?set COVER (the new core's cover)}"
SEED_OTHERS_WEI="${SEED_OTHERS_WEI:-300000000000000000}"     # 0.3 STT — other holders
SEED_POSITION_WEI="${SEED_POSITION_WEI:-100000000000000000}"  # 0.1 STT — policyholder's position
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CREATE_GAS=30000000
CALL_GAS=12000000

ME=$(cast wallet address --private-key "$PRIVATE_KEY")
echo ">> owner/holder: $ME"

echo ">> Deploying MockStable (pegged asset; setPrice stages a depeg)..."
STABLE=$(forge create src/mocks/MockStable.sol:MockStable \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  | grep "Deployed to:" | awk '{print $3}')
echo "   MockStable: $STABLE"

echo ">> Deploying the (generic) position adapter pointing at MockStable..."
ADAPTER=$(forge create src/mocks/MockVaultAdapter.sol:MockVaultAdapter \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$STABLE" | grep "Deployed to:" | awk '{print $3}')
echo "   Adapter: $ADAPTER"

echo ">> Seeding holdings at peg: deposit $SEED_OTHERS_WEI (others) + $SEED_POSITION_WEI (holder)..."
cast send "$STABLE" "deposit()" --value "$SEED_OTHERS_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
cast send "$STABLE" "deposit()" --value "$SEED_POSITION_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
echo "   price: $(cast call "$STABLE" 'price()(uint256)' --rpc-url "$RPC")  (1e18 == peg)"

echo ">> Ensuring cover is an authorized oracle consumer (idempotent)..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

DEPEG_KEY=$(cast call "$ORACLE" 'DEPEG_KEY()(bytes32)' --rpc-url "$RPC")
echo ">> registerTarget(MockStable, adapter, DEPEG_KEY=$DEPEG_KEY)..."
cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$STABLE" "$ADAPTER" "$DEPEG_KEY" "MockStable" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

echo ">> Risk assessment for MockStable (async)..."
# Present-tense facts; a pegged asset with thin backing scores MEDIUM/HIGH. (Forward-looking
# framing makes Qwen collapse to 0 — see spike doc.)
FACTS=$(cast from-utf8 '{"protocol":"a price-pegged stablecoin pegged to 1.0","audited":false,"numberOfSecurityAudits":0,"ageInDays":2,"collateralization":"partial and volatile","priorDepegEvents":1,"adminControl":"a single admin key can change the price feed with no timelock","liquidity":"thin bid-side depth"}')
cast send "$COVER" "requestRiskAssessment(address,bytes)" "$STABLE" "$FACTS" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

printf "   waiting for validators to return a risk score"
DEADLINE=$((SECONDS + 600))
until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$STABLE" --rpc-url "$RPC" 2>/dev/null)" = "true" ]; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "" >&2
    echo "   TIMED OUT after 10m — risk assessment never landed (check oracle balance / VerdictFailed)." >&2
    exit 1
  fi
  printf "."; sleep 10
done
echo " done."
SCORE=$(cast call "$COVER" 'riskScore(address)(uint256)' "$STABLE" --rpc-url "$RPC")
echo "   risk score: $SCORE"

# BUY=0 (default) leaves the position un-insured so the depeg BUY flow can be recorded live.
if [ "${BUY:-0}" = "1" ]; then
  echo ">> Buying $SEED_POSITION_WEI Depeg cover (365d) at the quoted premium..."
  PREMIUM=$(cast call "$COVER" 'quotePremium(address,uint256,uint64)(uint256)' \
    "$STABLE" "$SEED_POSITION_WEI" 31536000 --rpc-url "$RPC")
  PREMIUM=${PREMIUM%% *}
  # coverType 1 == Depeg
  cast send "$COVER" "buyPolicy(address,uint8,uint256,uint64)" "$STABLE" 1 "$SEED_POSITION_WEI" 31536000 \
    --value "$PREMIUM" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
else
  echo ">> BUY=0 → skipping depeg policy purchase (record the buy flow live)."
fi

echo ""
echo "=== MOCKSTABLE ARMED (Depeg) ==="
echo "MockStable:    $STABLE"
echo "Adapter:       $ADAPTER"
echo "Cover:         $COVER"
echo "listed:        $(cast call "$COVER" 'listedTargetsCount()(uint256)' --rpc-url "$RPC") target(s)"
echo "riskScore:     $SCORE   price: $(cast call "$STABLE" 'price()(uint256)' --rpc-url "$RPC")"
echo ""
echo ">> NOW UPDATE THESE:"
echo "   web/app/src/chain/config.ts   stable=$STABLE   stableAdapter=$ADAPTER"
echo "   web/app/.env (optional)       VITE_STABLE=$STABLE   VITE_STABLE_ADAPTER=$ADAPTER"
echo "   watcher/.env  TARGETS=<demovault>,$STABLE   TARGETS_KIND=tvl,price   PEG_WEI=,1000000000000000000   DEPEG_BAND_BPS=,200"
