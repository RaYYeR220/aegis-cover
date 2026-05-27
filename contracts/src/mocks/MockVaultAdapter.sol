// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPositionAdapter} from "../interfaces/IPositionAdapter.sol";

interface IMockVault {
    function recoverableOf(address user) external view returns (uint256);
}

/// @notice Position adapter for MockVault: a holder's recoverable position is their
/// pro-rata share of the vault's remaining assets.
contract MockVaultAdapter is IPositionAdapter {
    IMockVault public immutable vault;

    constructor(address _vault) {
        vault = IMockVault(_vault);
    }

    function positionOf(address user) external view override returns (uint256) {
        return vault.recoverableOf(user);
    }
}
