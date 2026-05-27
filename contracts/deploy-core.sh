#!/usr/bin/env bash
# Deploy the EXTENSIBLE marketplace core: a fresh ConsensusOracle (prompts seeded in its
# constructor: EXPLOIT / RISK / DEPEG) + a fresh AegisCover (registry + LP underwriting vault).
# This is the ONE redeploy — afterwards new perils are setSystemPrompt and new protocols are
# registerTarget, neither needing another core deploy.
#
# WHY forge create + explicit --gas-limit: forge under-estimates Somnia deploy gas ~10-15x.
#
# Usage from contracts/ with a funded OWNER key in .env:
#   bash deploy-core.sh
# Tunables (wei): ORACLE_FUND_WEI (consensus deposits), LP_FUND_WEI (owner = LP #1 capital).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
AGENT_REQUESTER="${AGENT_REQUESTER:?set AGENT_REQUESTER in .env}"
AGENT_ID="${AGENT_ID:?set AGENT_ID in .env}"
ORACLE_FUND_WEI="${ORACLE_FUND_WEI:-3000000000000000000}"  # 3 STT for consensus deposits (~0.4/run)
LP_FUND_WEI="${LP_FUND_WEI:-2000000000000000000}"          # 2 STT initial LP capital (owner = LP #1)
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

# The oracle constructor now seeds 3 system prompts (string SSTOREs) on top of a ~22M base deploy,
# pushing it past the old 30M cap. Shannon's block gas limit is ~500M, so give generous headroom.
CREATE_GAS=80000000
CALL_GAS=12000000

ME=$(cast wallet address --private-key "$PRIVATE_KEY")
echo ">> owner / LP #1: $ME"

echo ">> Deploying ConsensusOracle (sub=5, min=3, threshold=70, timeout=300; prompts seeded in ctor)..."
ORACLE=$(forge create src/ConsensusOracle.sol:ConsensusOracle \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$AGENT_REQUESTER" "$AGENT_ID" 5 3 70 300 \
  | grep "Deployed to:" | awk '{print $3}')
echo "   ConsensusOracle: $ORACLE"

echo ">> Deploying AegisCover (registry + LP vault)..."
COVER=$(forge create src/AegisCover.sol:AegisCover \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CREATE_GAS" --broadcast \
  --constructor-args "$ORACLE" \
  | grep "Deployed to:" | awk '{print $3}')
echo "   AegisCover: $COVER"

echo ">> Authorizing cover as oracle consumer..."
cast send "$ORACLE" "setConsumer(address,bool)" "$COVER" true \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

echo ">> Funding oracle deposit balance ($ORACLE_FUND_WEI wei)..."
cast send "$ORACLE" --value "$ORACLE_FUND_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

echo ">> Owner deposits initial LP capital ($LP_FUND_WEI wei) → mints pool shares..."
cast send "$COVER" "deposit()" --value "$LP_FUND_WEI" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

# Verify the DEPEG prompt seeded from AgentPrompt (sanity: should be a non-empty string).
DEPEG_KEY=$(cast call "$ORACLE" 'DEPEG_KEY()(bytes32)' --rpc-url "$RPC")
PROMPT_LEN=$(cast call "$ORACLE" 'systemPromptOf(bytes32)(string)' "$DEPEG_KEY" --rpc-url "$RPC" | wc -c)

echo ""
echo "=== CORE DEPLOYED ==="
echo "ConsensusOracle:  $ORACLE"
echo "AegisCover:       $COVER"
echo "authorizedConsumer(cover): $(cast call "$ORACLE" 'authorizedConsumer(address)(bool)' "$COVER" --rpc-url "$RPC")"
echo "DEPEG prompt seeded: $([ "$PROMPT_LEN" -gt 1 ] && echo yes || echo NO)  (len $PROMPT_LEN)"
echo "oracle balance:   $(cast balance "$ORACLE" --rpc-url "$RPC" --ether) STT"
echo "pool freeAssets:  $(cast call "$COVER" 'freeAssets()(uint256)' --rpc-url "$RPC")"
echo "owner shares:     $(cast call "$COVER" 'shares(address)(uint256)' "$ME" --rpc-url "$RPC")"
echo ""
echo ">> NEXT: register the targets on the new core, then propagate addresses:"
echo "   COVER=$COVER ORACLE=$ORACLE bash deploy-demovault.sh"
echo "   COVER=$COVER ORACLE=$ORACLE bash deploy-mockstable.sh"
echo "   web/app/src/chain/config.ts   oracle=$ORACLE   cover=$COVER"
echo "   watcher/.env                  COVER_ADDRESS=$COVER"
