// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Staking vault with a DELIBERATE access-control vulnerability (demo / CTF).
/// `rescueETH` was meant to be owner-only (emergency migration) but ships WITHOUT the guard —
/// so anyone can drain the entire pool (incl. other stakers' funds) to an address of their choice.
/// This is the #1 real-world exploit class (unprotected privileged function). Everything else
/// (detection, consensus, loss-calc, payout) is the real product path.
contract DemoVault {
    address public owner;
    mapping(address => uint256) public staked; // per-user principal
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Exploited(address indexed attacker, address indexed to, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function stake() external payable {
        require(msg.value > 0, "zero");
        staked[msg.sender] += msg.value;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /// @notice Legit withdrawal of your own stake (CEI-correct, not the vuln).
    function unstake(uint256 amount) external {
        require(staked[msg.sender] >= amount, "insufficient");
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Total value locked = the contract's actual balance.
    function tvl() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice A staker's recoverable position = balance-prorated stake (0 once drained).
    function recoverableOf(address user) public view returns (uint256) {
        if (totalStaked == 0) return 0;
        uint256 bal = address(this).balance;
        uint256 r = (staked[user] * bal) / totalStaked;
        return r > staked[user] ? staked[user] : r;
    }

    /// @dev THE BUG: no `onlyOwner`. Anyone can sweep the whole pool to `to`.
    function rescueETH(address to) external {
        uint256 bal = address(this).balance;
        (bool ok,) = to.call{value: bal}("");
        require(ok, "drain failed");
        emit Exploited(msg.sender, to, bal);
    }
}
