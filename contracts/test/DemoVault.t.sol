// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoVault} from "../src/mocks/DemoVault.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";

contract DemoVaultTest is Test {
    DemoVault vault;
    MockVaultAdapter adapter;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address attacker = address(0xBAD);

    function setUp() public {
        vault = new DemoVault();
        // The generic MockVaultAdapter wraps any vault exposing recoverableOf(address);
        // DemoVault matches, so the cover reuses it (no DemoVault-specific adapter needed).
        adapter = new MockVaultAdapter(address(vault));
    }

    function test_stake_and_tvl() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.stake{value: 0.3 ether}();
        assertEq(vault.tvl(), 0.3 ether);
        assertEq(vault.recoverableOf(alice), 0.3 ether);
    }

    function test_unstake_returns_own_funds() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vault.stake{value: 0.3 ether}();
        vault.unstake(0.1 ether);
        vm.stopPrank();
        assertEq(vault.tvl(), 0.2 ether);
        assertEq(alice.balance, 0.8 ether);
    }

    function test_exploit_drains_everyones_funds() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.stake{value: 0.3 ether}();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vault.stake{value: 0.1 ether}();
        assertEq(vault.tvl(), 0.4 ether);
        // attacker (not owner, not a staker) sweeps the whole pool via the unprotected rescueETH
        vm.prank(attacker);
        vault.rescueETH(attacker);
        assertEq(vault.tvl(), 0);
        assertEq(attacker.balance, 0.4 ether); // took alice's + bob's funds
        assertEq(vault.recoverableOf(alice), 0); // position wiped -> full loss for the cover
    }

    function test_adapter_mirrors_recoverable() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.stake{value: 0.3 ether}();
        assertEq(adapter.positionOf(alice), vault.recoverableOf(alice));
        assertEq(adapter.positionOf(alice), 0.3 ether);
        vm.prank(attacker);
        vault.rescueETH(attacker);
        assertEq(adapter.positionOf(alice), vault.recoverableOf(alice));
        assertEq(adapter.positionOf(alice), 0); // post-drain: cover sees full loss
    }
}
