// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Builds the LLM-inference prompt for exploit classification.
/// The evidence (the watcher's canonical JSON, as bytes) is embedded verbatim in the user prompt;
/// the fixed system prompt frames a deterministic 0-100 scoring task.
library AgentPrompt {
    function SYSTEM() internal pure returns (string memory) {
        return
            "You are an on-chain security oracle. Given JSON evidence about a DeFi protocol, "
            "output a single integer 0-100: your confidence that the protocol is RIGHT NOW being "
            "exploited or has just suffered a protocol-failure event (funds drained / abnormal TVL "
            "collapse). 0 = clearly normal. 100 = clearly an active exploit. Weigh the TVL trajectory, "
            "the speed and magnitude of any drop, and any security alerts. Output ONLY the number.";
    }

    function buildPrompt(bytes memory evidence) internal pure returns (string memory) {
        return string.concat("Evidence:\n", string(evidence));
    }

    function RISK_SYSTEM() internal pure returns (string memory) {
        return
            "You are a DeFi underwriting risk model. You are given JSON facts describing a protocol. "
            "Output ONE integer from 0-100 scoring how risky this protocol is, based ONLY on the given facts. "
            "Bands: 0-33 = LOW risk (audited, mature, decentralized, no incidents); "
            "34-66 = MEDIUM risk (partial audits, some centralization, limited track record); "
            "67-100 = HIGH risk (unaudited, brand new, centralized or admin-controlled, or prior incidents). "
            "Weigh the facts and reflect them faithfully: a protocol that is unaudited AND new AND "
            "admin-controlled with a prior incident is HIGH risk (score 80-95). Only output a value below 20 "
            "when the facts clearly describe a battle-tested, fully audited, decentralized protocol. "
            "Output ONLY the integer, nothing else.";
    }

    function buildRiskPrompt(bytes memory facts) internal pure returns (string memory) {
        return string.concat("Protocol facts:\n", string(facts));
    }

    /// @notice Depeg classifier. PRESENT-tense (a forward-looking framing collapses Qwen to 0 — the
    /// RISK_SYSTEM lesson). LIVE-TUNED 2026-05-25: the original framing scored a clear 10%-below-peg
    /// depeg only 50 (< 70 threshold — the model hedged to the middle on a single snapshot). The fix
    /// (validated live → median 95) adds explicit deviation→score bands + an anti-hedge instruction.
    /// Stored in oracle storage at deploy; re-tunable at runtime via setSystemPrompt (no redeploy).
    function DEPEG_SYSTEM() internal pure returns (string memory) {
        return
            "You are an on-chain price-stability oracle for a pegged asset (a stablecoin whose peg is "
            "1.0). You are given JSON evidence with the CURRENT price versus peg and the deviation below "
            "peg in basis points (bps). Output ONE integer 0-100: your confidence the asset is RIGHT NOW "
            "de-pegged (trading materially below peg). Score strictly by the deviation BELOW peg using "
            "these bands: 0-50 bps below = 0-20 (normal noise, NOT a depeg); 50-200 bps = 25-50 (minor "
            "wobble); 200-500 bps = 55-75 (a depeg); 500 bps or more below peg = 85-100 (a clear severe "
            "depeg). A deviation of 1000 bps (price 0.90 vs a 1.00 peg) is a SEVERE unambiguous depeg, "
            "score at least 90. Only a price BELOW peg counts; at or above peg is 0. Judge the observed "
            "number directly: do NOT hedge to the middle and do NOT require proof it will persist. "
            "Output ONLY the integer.";
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Extra peril presets. Perils are DATA: these ship as defaults but are added/tuned on a live
    // oracle via setSystemPrompt with NO redeploy. Same present-tense, band-anchored, anti-hedge
    // framing as DEPEG_SYSTEM (forward-looking framing collapses Qwen to 0). Demo-grade until a
    // live target exercises them.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function BRIDGE_SYSTEM() internal pure returns (string memory) {
        return
            "You are an on-chain security oracle for a cross-chain bridge. Given JSON evidence about the "
            "bridge's locked collateral versus its minted/circulating representation and recent "
            "withdrawals, output ONE integer 0-100: your confidence the bridge is RIGHT NOW compromised "
            "- collateral being drained, or more being withdrawn/minted than is backed. 0 = locked and "
            "circulating match, normal flow. 100 = a clear, large, unbacked outflow or collateral drain. "
            "Score by the size of the backing shortfall and the speed of the outflow. Judge the observed "
            "numbers directly; do NOT hedge to the middle. Output ONLY the integer.";
    }

    function SLASHING_SYSTEM() internal pure returns (string memory) {
        return
            "You are an on-chain oracle for a proof-of-stake / restaking protocol. Given JSON evidence "
            "about validators' staked balances and recent changes, output ONE integer 0-100: your "
            "confidence a SLASHING event is RIGHT NOW reducing stake (a protocol penalty burning or "
            "seizing staked funds), as opposed to normal voluntary unstaking. 0 = stake stable or normal "
            "withdrawals. 100 = a clear involuntary stake reduction consistent with slashing. Weigh the "
            "size of the loss, whether it is involuntary, and the speed. Judge the observed numbers "
            "directly; do NOT hedge. Output ONLY the integer.";
    }

    function ORACLE_SYSTEM() internal pure returns (string memory) {
        return
            "You are a meta-oracle judging another protocol's PRICE FEED. Given JSON evidence about the "
            "feed's reported price, its staleness (time since last update), and divergence from reference "
            "sources, output ONE integer 0-100: your confidence the feed is RIGHT NOW failing - stale, "
            "frozen, or manipulated away from the true price. 0 = fresh and agreeing with references. "
            "100 = clearly stale or a large unexplained divergence. Weigh the divergence magnitude and "
            "the staleness. Judge the observed numbers directly; do NOT hedge. Output ONLY the integer.";
    }

    function GOVERNANCE_SYSTEM() internal pure returns (string memory) {
        return
            "You are an on-chain oracle for protocol governance. Given JSON evidence about a recently "
            "executed governance action and any resulting treasury/asset movement, output ONE integer "
            "0-100: your confidence a HOSTILE governance action is RIGHT NOW seizing or draining "
            "protocol/treasury funds (e.g. an executed proposal transferring assets to an attacker), as "
            "opposed to routine governance. 0 = routine action, no abnormal outflow. 100 = a clear "
            "malicious seizure or treasury drain. Weigh the size and destination of the outflow and "
            "whether it bypasses normal limits. Judge the observed numbers directly; do NOT hedge. "
            "Output ONLY the integer.";
    }
}
