// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVault} from "../src/mocks/MockVault.sol";

contract MockVaultTest is Test {
    MockVault vault;
    address attacker = address(0xBAD);

    function setUp() public {
        vault = new MockVault();
    }

    function test_depositRaisesTvl() public {
        vault.deposit{value: 5 ether}();
        assertEq(vault.tvl(), 5 ether);
    }

    function test_exploitDrainsToAttacker() public {
        vault.deposit{value: 5 ether}();
        vault.exploit(payable(attacker));
        assertEq(vault.tvl(), 0);
        assertEq(attacker.balance, 5 ether);
    }

    function test_depositTracksPerUserAndTotal() public {
        address alice = address(0xA11CE);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        assertEq(vault.deposited(alice), 0.1 ether);
        assertEq(vault.totalDeposited(), 0.1 ether);
    }

    function test_recoverableOf_fullWhenHealthy() public {
        address alice = address(0xA11CE);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        assertEq(vault.recoverableOf(alice), 0.1 ether);
    }

    function test_recoverableOf_zeroAfterFullDrain() public {
        address alice = address(0xA11CE);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        vault.exploit(payable(attacker));
        assertEq(vault.recoverableOf(alice), 0);
    }

    function test_recoverableOf_proRataOnPartialLoss() public {
        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        vm.prank(bob);
        vault.deposit{value: 0.1 ether}();
        // simulate a 50% loss: vault balance halved (0.2 -> 0.1)
        vm.deal(address(vault), 0.1 ether);
        // alice's pro-rata share: 0.1 * 0.1 / 0.2 = 0.05
        assertEq(vault.recoverableOf(alice), 0.05 ether);
    }

    function test_withdrawReducesPositionAndTotal() public {
        address alice = address(0xA11CE);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        vm.prank(alice);
        vault.withdraw(0.04 ether);
        assertEq(vault.deposited(alice), 0.06 ether);
        assertEq(vault.totalDeposited(), 0.06 ether);
    }
}
