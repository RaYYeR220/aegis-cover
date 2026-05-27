// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Demo "victim" protocol with per-user accounting so Aegis can value each
/// holder's recoverable position. TVL == its balance. exploit() simulates a drain hack.
contract MockVault {
    mapping(address => uint256) public deposited; // nominal principal per user
    uint256 public totalDeposited;

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);
    event Exploited(address indexed attacker, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "zero");
        deposited[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function tvl() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice A holder's *recoverable* value = their pro-rata share of remaining assets.
    /// Healthy (balance == totalDeposited) -> their principal. Full drain (balance 0) -> 0.
    function recoverableOf(address user) public view returns (uint256) {
        if (totalDeposited == 0) return 0;
        return deposited[user] * address(this).balance / totalDeposited;
    }

    function withdraw(uint256 amount) external {
        require(deposited[msg.sender] >= amount, "insufficient");
        deposited[msg.sender] -= amount;
        totalDeposited -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdraw(msg.sender, amount);
    }

    /// @notice Drain everything to `attacker` — the staged exploit the watcher detects.
    /// Leaves `deposited`/`totalDeposited` intact so recoverableOf reflects the loss
    /// (balance 0 -> recoverable 0) without rewriting per-user records.
    function exploit(address payable attacker) external {
        uint256 amount = address(this).balance;
        (bool ok,) = attacker.call{value: amount}("");
        require(ok, "drain failed");
        emit Exploited(attacker, amount);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
}
