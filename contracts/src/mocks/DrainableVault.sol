// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Demo "yield vault" carrying a REAL reentrancy bug — the canonical The-DAO class, the most
/// recognizable DeFi exploit. `withdraw` sends ETH to the caller BEFORE updating their balance
/// (interaction-before-effect), so a contract caller can re-enter `withdraw` from its receive() and
/// drain the WHOLE pool — every staker's funds — in a single transaction. The balance decrements are
/// `unchecked` (a plausible "gas optimization"), so the nested decrements wrap instead of reverting on
/// Solidity 0.8 (a checked decrement would revert the drain on unwind — which is why the simpler
/// access-control DemoVault was used for the autonomous phase; this is the realistic exploit for the demo).
///
/// `recoverableOf` is pro-rata of remaining assets (mirrors MockVault), so the generic MockVaultAdapter
/// values a holder's position and the deterministic loss-calc credits the loss after the drain.
contract DrainableVault {
    mapping(address => uint256) public balanceOf; // nominal principal per staker
    uint256 public totalDeposited;

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "zero");
        balanceOf[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice THE BUG: the ETH send (interaction) happens BEFORE the balance update (effect), so a
    /// contract caller can re-enter here from receive() while its recorded balance is still intact and
    /// withdraw again and again. The `unchecked` decrements wrap instead of reverting on the unwind.
    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        (bool ok,) = msg.sender.call{value: amount}(""); // ← interaction first (the reentrancy hole)
        require(ok, "transfer failed");
        unchecked {
            balanceOf[msg.sender] -= amount; // ← effect after the call; unchecked so the drain doesn't revert
            totalDeposited -= amount;
        }
        emit Withdraw(msg.sender, amount);
    }

    function tvl() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice A holder's recoverable value = pro-rata share of the vault's remaining assets.
    /// Healthy → their principal; after a full drain (balance 0) → 0.
    function recoverableOf(address user) external view returns (uint256) {
        if (totalDeposited == 0 || address(this).balance == 0) return 0;
        return balanceOf[user] * address(this).balance / totalDeposited;
    }

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposit(msg.sender, msg.value);
    }
}
