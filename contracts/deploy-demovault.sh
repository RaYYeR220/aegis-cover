#!/usr/bin/env bash
# Deploy DemoVault (real access-control vuln) + its adapter, then wire them into the
# EXISTING AegisCover (no cover redeploy needed — DemoVault is a NEW target on it, so
# targetSettled[DemoVault] is false and the per-cover risk cache just gets a new key).
#
# This is the autonomous-product target: the watcher runs live against DemoVault and
# auto-fires consensus when the pool is drained. The only staged action is the exploit tx.
#
# Usage from contracts/ with a funded OWNER key in .env:
#   bash deploy-demovault.sh           # arm without buying (record the buy flow live)
#   BUY=1 bash deploy-demovault.sh     # pre-buy the 0.1 policy too
# Override reused addresses if they ever change:
#   ORACLE=0x.. COVER=0x.. bash deploy-demovault.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
ORACLE="${ORACLE:-0xcF064aAC45Aa3Ec9d2eD0fA706fb5B549c362cda}"
COVER="${COVER:-0xbd9668F62B2e5b011191c4C9Ef8D0b16606b1796}"   # reuse the live v2.1 cover
POOL_MIN_WEI="${POOL_MIN_WEI:-130000000000000000}"             # 0.13 STT (>= payout 0.09 + buffer)
SEED_OTHERS_WEI="${SEED_OTHERS_WEI:-300000000000000000}"        # 0.3 STT — models OTHER stakers' funds
SEED_POSITION_WEI="${SEED_POSITION_WEI:-100000000000000000}"    # 0.1 STT — the policyholder's position
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CREATE_GAS=30000000   # forge under-estimates Somnia deploy gas ~10-15x; explicit limit is required
CALL_GAS=12000000     # consensus-triggering calls (requestRiskAssessment) need ~3.6M+; pin 12M

ME=$(cast wallet address --private-key "$PRIVATE_KEY")  # prints only the public address
echo ">> owner/holder: $ME"

echo ">> Deploying DemoVault (real access-control vuln: rescueETH ships without onlyOwner)..."
VAULT=$(forge create src/mocks/DemoVault.sol:DemoVault \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  | grep "Deployed to:" | awk '{print $3}')
echo "   DemoVault: $VAULT"

echo ">> Deploying the (generic) position adapter pointing at DemoVault..."
ADAPTER=$(forge create src/mocks/MockVaultAdapter.sol:MockVaultAdapter \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$VAULT" | grep "Deployed to:" | awk '{print $3}')
echo "   Adapter: $ADAPTER"

# Seed TVL with two stakes. Both come from the owner wallet (single-wallet demo) but they
# MODEL distinct depositors: 0.3 = "other stakers", 0.1 = the policyholder's own position.
# A rescueETH drain therefore sweeps funds that aren't (conceptually) the attacker's.
echo ">> Seeding TVL: stake $SEED_OTHERS_WEI (others) + $SEED_POSITION_WEI (policyholder)..."
cast send "$VAULT" "stake()" --value "$SEED_OTHERS_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
cast send "$VAULT" "stake()" --value "$SEED_POSITION_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
echo "   TVL: $(cast balance "$VAULT" --rpc-url "$RPC" --ether) STT"

# setConsumer is already true for this reused cover; re-assert it anyway (idempotent) so the
# script is self-contained if COVER is overridden with a fresh deployment.
echo ">> Ensuring cover is an authorized oracle consumer (idempotent)..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
# registerTarget lists DemoVault in the catalog under the EXPLOIT peril (so requestCheck routes to
# the exploit prompt and the marketplace UI shows it). Read EXPLOIT_KEY from the cover (authoritative).
EXPLOIT_KEY=$(cast call "$COVER" 'EXPLOIT_KEY()(bytes32)' --rpc-url "$RPC")
echo ">> registerTarget(DemoVault, adapter, EXPLOIT_KEY=$EXPLOIT_KEY) on the cover..."
cast send "$COVER" "registerTarget(address,address,bytes32,string)" "$VAULT" "$ADAPTER" "$EXPLOIT_KEY" "DemoVault" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null

# Top the pool up to >= POOL_MIN_WEI only if it's short (the reused cover may already hold funds).
POOL_NOW=$(cast balance "$COVER" --rpc-url "$RPC")
if [ "$POOL_NOW" -lt "$POOL_MIN_WEI" ]; then
  TOPUP=$((POOL_MIN_WEI - POOL_NOW))
  echo ">> Pool $POOL_NOW wei < $POOL_MIN_WEI — topping up $TOPUP wei..."
  cast send "$COVER" "fundPool()" --value "$TOPUP" \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit 8000000 >/dev/null
else
  echo ">> Pool already $POOL_NOW wei (>= $POOL_MIN_WEI) — no top-up."
fi

echo ">> Risk assessment for DemoVault (per-target cache key is new; async)..."
# Present-tense factual facts; the reworked RISK_SYSTEM scores this ~75 (High). A forward-looking
# "risk over the next year" framing makes Qwen collapse to 0 (see spike doc).
FACTS=$(cast from-utf8 '{"protocol":"a DeFi staking vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"controlled by a single externally-owned admin key with full upgrade power, no timelock and no multisig","oracleDependency":"a single unverified price source","userDepositsUSD":50000,"liquidity":"thin"}')
cast send "$COVER" "requestRiskAssessment(address,bytes)" "$VAULT" "$FACTS" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

printf "   waiting for validators to return a risk score"
DEADLINE=$((SECONDS + 600))   # 10-min cap — fail loud rather than spin forever if it never lands
until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$VAULT" --rpc-url "$RPC" 2>/dev/null)" = "true" ]; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "" >&2
    echo "   TIMED OUT after 10m — risk assessment never landed (check oracle balance / a VerdictFailed under-response)." >&2
    exit 1
  fi
  printf "."; sleep 10
done
echo " done."
SCORE=$(cast call "$COVER" 'riskScore(address)(uint256)' "$VAULT" --rpc-url "$RPC")
echo "   risk score: $SCORE"

# BUY=0 (default) leaves the position un-insured so you can record the BUY flow live.
# BUY=1 pre-buys the 0.1 policy → cover fully armed for an exploit->claim without on-camera buying.
if [ "${BUY:-0}" = "1" ]; then
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
echo "=== DEMOVAULT ARMED ==="
echo "DemoVault:     $VAULT"
echo "Adapter:       $ADAPTER"
echo "Cover (reused):$COVER"
echo "targetSettled: $(cast call "$COVER" 'targetSettled(address)(bool)' "$VAULT" --rpc-url "$RPC")"
echo "riskScore:     $SCORE   pool: $(cast balance "$COVER" --rpc-url "$RPC" --ether) STT   TVL: $(cast balance "$VAULT" --rpc-url "$RPC" --ether) STT"
echo ""
echo ">> NOW UPDATE THESE:"
echo "   web/app/src/chain/config.ts   vault=$VAULT   adapter=$ADAPTER"
echo "   web/app/.env (optional)       VITE_VAULT=$VAULT   VITE_ADAPTER=$ADAPTER"
echo "   watcher/.env (+ .env.example) COVER_ADDRESS=$COVER   TARGETS=$VAULT"
