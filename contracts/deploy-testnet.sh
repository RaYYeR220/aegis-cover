#!/usr/bin/env bash
# Reproducible Aegis v2 deploy to Somnia Shannon testnet.
#
# WHY forge create (not `forge script --broadcast`): forge under-estimates deploy gas
# ~10-15x on Somnia, so broadcast txs run out of gas. forge create + explicit --gas-limit
# is what works.
#
# Usage from contracts/, with a funded throwaway key in .env:
#   bash deploy-testnet.sh            # deploy + wire + fund
#   SEED=1 bash deploy-testnet.sh     # also seed the live demo (deposit, assess, buy)
set -euo pipefail

cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
AGENT_REQUESTER="${AGENT_REQUESTER:?set AGENT_REQUESTER in .env}"
AGENT_ID="${AGENT_ID:?set AGENT_ID in .env}"
ORACLE_FUND_WEI="${ORACLE_FUND_WEI:-2000000000000000000}"
POOL_FUND_WEI="${POOL_FUND_WEI:-500000000000000000}"
SEED_POSITION_WEI="${SEED_POSITION_WEI:-100000000000000000}" # 0.1 STT demo position
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CREATE_GAS=30000000   # ~15x headroom over forge's (wrong) estimate
# Consensus-triggering calls (requestRiskAssessment / requestCheck) hit the native
# createAdvancedRequest (~3.6M gas: subcommittee selection + storage). 2M OOGs and
# silently reverts (cast send still exits 0). 8M gives headroom; plain funding
# transfers ignore the unused cap.
CALL_GAS=8000000

echo ">> Deploying ConsensusOracle (sub=5, min=3, threshold=70, timeout=300)..."
ORACLE=$(forge create src/ConsensusOracle.sol:ConsensusOracle \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$AGENT_REQUESTER" "$AGENT_ID" 5 3 70 300 \
  | grep "Deployed to:" | awk '{print $3}')
echo "   ConsensusOracle: $ORACLE"

echo ">> Deploying AegisCover..."
COVER=$(forge create src/AegisCover.sol:AegisCover \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$ORACLE" \
  | grep "Deployed to:" | awk '{print $3}')
echo "   AegisCover: $COVER"

echo ">> Deploying MockVault (demo victim)..."
VAULT=$(forge create src/mocks/MockVault.sol:MockVault \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  | grep "Deployed to:" | awk '{print $3}')
echo "   MockVault: $VAULT"

echo ">> Deploying MockVaultAdapter..."
ADAPTER=$(forge create src/mocks/MockVaultAdapter.sol:MockVaultAdapter \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$VAULT" \
  | grep "Deployed to:" | awk '{print $3}')
echo "   MockVaultAdapter: $ADAPTER"

echo ">> Authorizing cover as oracle consumer..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null
echo ">> Registering adapter for vault..."
cast send "$COVER" "setAdapter(address,address)" "$VAULT" "$ADAPTER" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null
echo ">> Funding oracle deposit balance ($ORACLE_FUND_WEI wei)..."
cast send "$ORACLE" --value "$ORACLE_FUND_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null
echo ">> Funding cover pool ($POOL_FUND_WEI wei)..."
cast send "$COVER" "fundPool()" --value "$POOL_FUND_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

if [ "${SEED:-0}" = "1" ]; then
  echo ">> [seed] Depositing demo position ($SEED_POSITION_WEI wei) into vault..."
  cast send "$VAULT" "deposit()" --value "$SEED_POSITION_WEI" \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

  echo ">> [seed] Requesting agent risk assessment (async, ~1-2 min)..."
  # Present-tense factual facts; the reworked RISK_SYSTEM prompt scores this ~75 (High).
  # NB: a forward-looking "risk over next year" framing makes Qwen collapse to 0 (see spike doc).
  FACTS=$(cast from-utf8 '{"protocol":"a DeFi staking vault","audited":false,"numberOfSecurityAudits":0,"ageInDays":1,"priorSecurityIncidents":1,"adminControl":"controlled by a single externally-owned admin key with full upgrade power, no timelock and no multisig","oracleDependency":"a single unverified price source","userDepositsUSD":50000,"liquidity":"thin"}')
  cast send "$COVER" "requestRiskAssessment(address,bytes)" "$VAULT" "$FACTS" \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

  printf "   waiting for validators to return a risk score"
  until [ "$(cast call "$COVER" 'riskAssessed(address)(bool)' "$VAULT" --rpc-url "$RPC")" = "true" ]; do
    printf "."; sleep 10
  done
  echo " done."
  SCORE=$(cast call "$COVER" 'riskScore(address)(uint256)' "$VAULT" --rpc-url "$RPC")
  RATE=$(cast call "$COVER" 'rateBps(address)(uint256)' "$VAULT" --rpc-url "$RPC")
  echo "   risk score: $SCORE   rate(bps): $RATE"

  echo ">> [seed] Buying 0.1 STT Exploit cover (365d) at the quoted premium..."
  PREMIUM=$(cast call "$COVER" 'quotePremium(address,uint256,uint64)(uint256)' \
    "$VAULT" "$SEED_POSITION_WEI" 31536000 --rpc-url "$RPC")
  cast send "$COVER" "buyPolicy(address,uint8,uint256,uint64)" "$VAULT" 0 "$SEED_POSITION_WEI" 31536000 \
    --value "$PREMIUM" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null
  echo "   policy bought (premium $PREMIUM wei). Demo is armed: trigger vault.exploit() to settle live."
fi

echo ""
echo "=== Deployed & wired ==="
echo "ConsensusOracle:  $ORACLE"
echo "AegisCover:       $COVER"
echo "MockVault:        $VAULT"
echo "MockVaultAdapter: $ADAPTER"
echo "authorizedConsumer(cover): $(cast call "$ORACLE" 'authorizedConsumer(address)(bool)' "$COVER" --rpc-url "$RPC")"
echo "adapter(vault):   $(cast call "$COVER" 'adapter(address)(address)' "$VAULT" --rpc-url "$RPC")"
echo "oracle balance:   $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"
echo "pool balance:     $(cast balance "$COVER" --rpc-url "$RPC" --ether) STT"
