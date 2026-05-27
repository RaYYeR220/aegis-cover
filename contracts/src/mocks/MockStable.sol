// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Demo pegged-asset protocol (a "stablecoin" pegged to 1.0). Holders deposit() STT and
/// hold a nominal balance; `price` (1e18 = peg) is owner-settable to STAGE a depeg for the demo.
/// A holder's recoverable position is price-scaled, so the generic MockVaultAdapter values it
/// correctly both at peg and after a depeg — the deterministic loss-calc then credits the loss.
/// Benign target (not the vuln vault): no reentrancy surface, no exploit().
contract MockStable {
    address public owner;
    mapping(address => uint256) public balanceOf; // nominal principal per holder
    uint256 public totalDeposited;
    uint256 public price = 1e18; // 1e18 == peg (1.0); below this is a depeg

    event Deposited(address indexed from, uint256 amount);
    event PriceSet(uint256 price);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        require(msg.value > 0, "zero");
        balanceOf[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Stage a depeg (or re-peg) by setting the price. 0.9e18 = trading 10% below peg.
    function setPrice(uint256 _price) external onlyOwner {
        price = _price;
        emit PriceSet(_price);
    }

    function tvl() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice A holder's recoverable value = nominal balance scaled by the current price.
    /// At peg (price == 1e18) this is their principal; a depeg scales it down proportionally.
    function recoverableOf(address user) external view returns (uint256) {
        return balanceOf[user] * price / 1e18;
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
}
