// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Values a user's *recoverable* position (in wei) in a covered protocol.
/// Aegis is protocol-agnostic: each covered target registers an adapter that knows
/// how to value a holder's stake in that specific protocol. Loss-calc reads
/// positionOf at purchase (the insured baseline) and again at settlement.
interface IPositionAdapter {
    function positionOf(address user) external view returns (uint256);
}
