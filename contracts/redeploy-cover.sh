#!/usr/bin/env bash
# Redeploy ONLY AegisCover (the #4-over-insurance-fixed bytecode) reusing the existing
# v2.1 ConsensusOracle / MockVault / MockVaultAdapter, then wire + fund + arm it.
# Produces a fresh, un-settled, ARMED cover — for the #4 fix and/or a clean retake.
#
# WHY: AegisCover.targetSettled is sticky per (cover, vault); the risk cache is per-cover.
# A retake (another exploit->claim) therefore needs a brand-new cover, re-assessed + re-bought.
#
# Usage from contracts/ with a funded OWNER key in .env:
#   bash redeploy-cover.sh
# Override the reused addresses if they ever change:
#   ORACLE=0x.. VAULT=0x.. ADAPTER=0x.. bash redeploy-cover.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:-0xcF064aAC45Aa3Ec9d2eD0fA706fb5B549c362cda}"
VAULT="${VAULT:-0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1}"
ADAPTER="${ADAPTER:-0xbb5c05099A2d2Ae94c069f3fEE52B49DE1Af6C78}"
POOL_FUND_WEI="${POOL_FUND_WEI:-130000000000000000}"      # 0.13 STT (>= payout 0.09 + buffer)
SEED_POSITION_WEI="${SEED_POSITION_WEI:-100000000000000000}" # 0.1 STT demo position
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CREATE_GAS=30000000   # forge under-estimates Somnia deploy gas ~10-15x; explicit limit is required
CALL_GAS=12000000     # consensus-triggering calls (requestRiskAssessment) need ~3.6M+; pin 12M

ME=$(cast wallet address --private-key "$PRIVATE_KEY")  # prints only the public address
echo ">> owner/holder: $ME"

echo ">> Deploying fresh AegisCover (oracle=$ORACLE)..."
COVER=$(forge create src/AegisCover.sol:AegisCover \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$ORACLE" | grep "Deployed to:" | awk '{print $3}')
echo "   AegisCover: $COVER"

echo ">> Authorizing new cover as oracle consumer..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
echo ">> Registering adapter for vault on the new cover..."
cast send "$COVER" "setAdapter(address,address)" "$VAULT" "$ADAPTER" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
echo ">> Funding cover pool ($POOL_FUND_WEI wei)..."
cast send "$COVER" "fundPool()" --value "$POOL_FUND_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

# Ensure the holder has a position in the (reused) vault — deposit only if it was drained.
POS=$(cast call "$ADAPTER" 'positionOf(address)(uint256)' "$ME" --rpc-url "$RPC")
POS=${POS%% *}  # strip any trailing "[1e17]" annotation
if [ "$POS" = "0" ]; then
  echo ">> Vault position is 0 — depositing $SEED_POSITION_WEI wei..."
  cast send "$VAULT" "deposit()" --value "$SEED_POSITION_WEI" \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
else
  echo ">> Vault position already $POS wei — reusing it."
fi

echo ">> Risk assessment on the new cover (per-cover cache is empty; async ~1-2 min)..."
# Present-tense factual facts; the reworked RISK_SYSTEM scores this ~75 (High). A forward-looking
# "risk over the next year" framing makes Qwen collapse to 0 (see spike doc).
FACTS=$(cast from-utf8 '{"protocol":"a DeFi staking vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"controlled by a single externally-owned admin key with full upgrade power, no timelock and no multisig","oracleDependency":"a single unverified price source","userDepositsUSD":50000,"liquidity":"thin"}')
cast send "$COVER" "requestRiskAssessment(address,bytes)" "$VAULT" "$FACTS" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

printf "   waiting for validators to return a risk score"
until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$VAULT" --rpc-url "$RPC")" = "true" ]; do
  printf "."; sleep 10
done
echo " done."
SCORE=$(cast call "$COVER" 'riskScore(address)(uint256)' "$VAULT" --rpc-url "$RPC")
echo "   risk score: $SCORE"

# BUY=1 (default) pre-buys the 0.1 policy → cover is fully armed for an exploit→claim.
# BUY=0 leaves the position un-insured so you can record the BUY flow live (deposit is still in place).
if [ "${BUY:-1}" = "1" ]; then
  echo ">> Buying 0.1 STT Exploit cover (365d) at the quoted premium..."
  PREMIUM=$(cast call "$COVER" 'quotePremium(address,uint256,uint64)(uint256)' \
    "$VAULT" "$SEED_POSITION_WEI" 31536000 --rpc-url "$RPC")
  PREMIUM=${PREMIUM%% *}
  cast send "$COVER" "buyPolicy(address,uint8,uint256,uint64)" "$VAULT" 0 "$SEED_POSITION_WEI" 31536000 \
    --value "$PREMIUM" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
else
  echo ">> BUY=0 → skipping policy purchase (record the buy flow live from the Policies page)."
fi

echo ""
echo "=== FRESH COVER ARMED ==="
echo "AegisCover (new): $COVER"
echo "targetSettled:    $(cast call "$COVER" 'targetSettled(address)(bool)' "$VAULT" --rpc-url "$RPC")"
echo "riskScore:        $SCORE   pool: $(cast balance "$COVER" --rpc-url "$RPC" --ether) STT"
echo ""
echo ">> NOW UPDATE THE NEW COVER ADDRESS in:"
echo "   web/app/src/chain/config.ts  (cover default)  — or web/app/.env  VITE_COVER=$COVER"
echo "   watcher/.env (+ .env.example)  COVER_ADDRESS=$COVER"
