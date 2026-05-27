#!/usr/bin/env bash
# Live demo settlement loop on an ARMED cover (CLI fallback for the UI flow):
#   exploit(self) -> requestCheck(strong exploit evidence) -> poll verdict -> claim().
# The headline for the recording is normally driven from the Guardian UI (DemoControls);
# use this if the UI hiccups, or for a quick CLI rehearsal.
#
# Usage from contracts/ with the OWNER key in .env (defaults = current v2.1 deployment):
#   bash demo-loop.sh
#   COVER=0x.. VAULT=0x.. bash demo-loop.sh
#
# NOTE: this SETTLES the cover for the vault (one-way). A repeat needs a fresh cover
# (run redeploy-cover.sh first).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

RPC="${SOMNIA_TESTNET_RPC:-https://api.infra.testnet.somnia.network}"
COVER="${COVER:-0xbd9668F62B2e5b011191c4C9Ef8D0b16606b1796}"
VAULT="${VAULT:-0xCdfbBf9958CF4164C5F8F6eCbCbce985114C13D1}"
: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"

CONSENSUS_GAS=12000000  # requestCheck hits createAdvancedRequest (~3.6M+); Somnia under-estimates
CALL_GAS=8000000
ME=$(cast wallet address --private-key "$PRIVATE_KEY")

echo ">> owner/attacker(self): $ME"
echo ">> TVL before: $(cast call "$VAULT" 'tvl()(uint256)' --rpc-url "$RPC") wei"
echo ">> claimable before: $(cast call "$COVER" 'claimable(address)(uint256)' "$ME" --rpc-url "$RPC") wei"

if [ "$(cast call "$COVER" 'targetSettled(address)(bool)' "$VAULT" --rpc-url "$RPC")" = "true" ]; then
  echo "!! targetSettled is already TRUE for this (cover,vault) — this cover is spent."
  echo "   Run redeploy-cover.sh for a fresh armed cover, then re-run with COVER=<new>."
  exit 1
fi

echo ">> exploit(): draining the vault to self (TVL -> 0)..."
cast send "$VAULT" "exploit(address)" "$ME" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null
echo "   TVL after exploit: $(cast call "$VAULT" 'tvl()(uint256)' --rpc-url "$RPC") wei"

echo ">> requestCheck(): submitting exploit evidence to the consensus oracle..."
TS=$(date +%s)
EVID=$(cast from-utf8 "{\"schema\":\"aegis-exploit-evidence/1\",\"target\":\"$VAULT\",\"observedAt\":$TS,\"tvl\":{\"before\":\"100000000000000000\",\"after\":\"0\",\"deltaBps\":-10000,\"windowSeconds\":38},\"signals\":{\"largestDropBps\":-10000,\"web2Alerts\":[\"security alert: the vault was fully drained to a single attacker address in under a minute\",\"on-chain monitoring: TVL fell 100% to zero\"]}}")
cast send "$COVER" "requestCheck(address,bytes)" "$VAULT" "$EVID" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CONSENSUS_GAS" >/dev/null

printf ">> waiting for the validator consensus verdict (~1-2 min)"
until [ "$(cast call "$COVER" 'targetSettled(address)(bool)' "$VAULT" --rpc-url "$RPC")" = "true" ]; do
  printf "."; sleep 10
done
echo " confirmed."

CLAIMABLE=$(cast call "$COVER" 'claimable(address)(uint256)' "$ME" --rpc-url "$RPC")
echo ">> claimable now: $CLAIMABLE wei"
if [ "${CLAIMABLE%% *}" = "0" ]; then
  echo "!! verdict landed but claimable is 0 — the verdict may have been NOT-confirmed (median < 70),"
  echo "   or the pool was insufficient. Inspect VerdictReceived/Payout logs on the cover."
  exit 1
fi

echo ">> claim()..."
cast send "$COVER" "claim()" \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --gas-limit "$CALL_GAS" >/dev/null

echo ""
echo "=== DONE ==="
echo "claimable after: $(cast call "$COVER" 'claimable(address)(uint256)' "$ME" --rpc-url "$RPC") wei (expect 0)"
echo "wallet balance:  $(cast balance "$ME" --rpc-url "$RPC" --ether) STT"
echo "Explorer: https://shannon-explorer.somnia.network/address/$COVER"
