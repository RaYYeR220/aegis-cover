// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Implemented by any app that consumes a reconciled verdict from ConsensusOracle.
interface IVerdictConsumer {
    /// @param questionId opaque id the consumer supplied when requesting the verdict
    /// @param score reconciled score (median of validator scores), 0..100.
    ///        NOTE: for even response counts the median is floor-rounded (integer division),
    ///        so e.g. median({69,71}) == 70. Use an odd subcommitteeSize to avoid the tie case.
    /// @param confirmed true when score >= the oracle's configured threshold
    function onVerdict(bytes32 questionId, uint256 score, bool confirmed) external;
}
