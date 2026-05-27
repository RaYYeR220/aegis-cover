// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal interface AegisCover depends on, decoupling the consumer from the
/// concrete ConsensusOracle implementation. Two prompt variants, same median engine:
/// requestVerdict = exploit adjudication; requestRiskVerdict = underwriting risk score.
interface IConsensusOracle {
    function requestVerdict(bytes32 questionId, bytes calldata evidence) external returns (uint256 requestId);
    function requestRiskVerdict(bytes32 questionId, bytes calldata facts) external returns (uint256 requestId);

    /// @notice Request an adjudication using the system prompt stored under `promptKey`.
    /// Lets the consumer route per-peril (EXPLOIT / DEPEG / future perils) without a redeploy.
    function requestVerdictFor(bytes32 questionId, bytes calldata evidence, bytes32 promptKey)
        external
        returns (uint256 requestId);

    /// @notice Owner-only: set/replace the system prompt stored under `key` (runtime-editable).
    function setSystemPrompt(bytes32 key, string calldata prompt) external;
}
