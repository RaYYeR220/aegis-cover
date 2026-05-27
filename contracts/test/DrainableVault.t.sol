// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrainableVault} from "../src/mocks/DrainableVault.sol";
import {ReentrancyAttacker} from "../src/mocks/ReentrancyAttacker.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";

/// The reentrancy exploit target: a real interaction-before-effect bug an attacker contract drains in
/// one tx, taking every staker's funds. recoverableOf is pro-rata, so the generic adapter + loss-calc
/// credit the loss exactly as for the access-control DemoVault.
contract DrainableVaultTest is Test {
    DrainableVault vault;
    MockVaultAdapter adapter;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vault = new DrainableVault();
        adapter = new MockVaultAdapter(address(vault));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(address(this), 10 ether); // funds the attack() call
    }

    function _stake(address who, uint256 amount) internal {
        vm.prank(who);
        vault.deposit{value: amount}();
    }

    function test_deposit_tvl_recoverable() public {
        _stake(alice, 0.3 ether);
        _stake(bob, 0.1 ether);
        assertEq(vault.tvl(), 0.4 ether);
        assertEq(vault.recoverableOf(alice), 0.3 ether);
        assertEq(vault.recoverableOf(bob), 0.1 ether);
    }

    function test_reentrancy_drainsEveryone() public {
        _stake(alice, 0.3 ether);
        _stake(bob, 0.1 ether); // TVL 0.4 (others' funds)

        ReentrancyAttacker attacker = new ReentrancyAttacker(address(vault));
        attacker.attack{value: 0.1 ether}(); // seed 0.1 → re-enter → drain all 0.5

        assertEq(vault.tvl(), 0); // pool fully drained
        assertEq(vault.recoverableOf(alice), 0); // stakers wiped out
        assertEq(vault.recoverableOf(bob), 0);
        assertEq(address(attacker).balance, 0.5 ether); // attacker took everything (0.4 profit)
    }

    function test_adapter_mirrorsRecoverable_beforeAndAfter() public {
        _stake(alice, 0.3 ether);
        _stake(bob, 0.1 ether);
        assertEq(adapter.positionOf(alice), vault.recoverableOf(alice)); // healthy

        ReentrancyAttacker attacker = new ReentrancyAttacker(address(vault));
        attacker.attack{value: 0.1 ether}();
        assertEq(adapter.positionOf(alice), vault.recoverableOf(alice)); // after drain
        assertEq(adapter.positionOf(alice), 0);
    }

    function test_sweep_sendsLootToAttackerEOA() public {
        _stake(alice, 0.3 ether);
        ReentrancyAttacker attacker = new ReentrancyAttacker(address(vault));
        attacker.attack{value: 0.1 ether}(); // drains 0.4 total into the attacker contract
        assertEq(address(attacker).balance, 0.4 ether);

        address eoa = address(0xDEAD);
        attacker.sweep(payable(eoa));
        assertEq(address(attacker).balance, 0);
        assertEq(eoa.balance, 0.4 ether);
    }
}
