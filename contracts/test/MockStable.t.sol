// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockStable} from "../src/mocks/MockStable.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";

/// MockStable is a pegged-asset demo target. recoverableOf is price-scaled, so the generic
/// MockVaultAdapter values a holder's position correctly at peg AND after a staged depeg.
contract MockStableTest is Test {
    MockStable stable;
    MockVaultAdapter adapter;
    address alice = address(0xA11CE);

    function setUp() public {
        stable = new MockStable();
        adapter = new MockVaultAdapter(address(stable));
        vm.deal(alice, 100 ether);
    }

    function test_deposit_accruesBalanceAndTvlAtPeg() public {
        vm.prank(alice);
        stable.deposit{value: 1 ether}();
        assertEq(stable.balanceOf(alice), 1 ether);
        assertEq(stable.totalDeposited(), 1 ether);
        assertEq(stable.tvl(), 1 ether);
        assertEq(stable.price(), 1e18); // starts at peg
    }

    function test_recoverableOf_atPeg_equalsBalance() public {
        vm.prank(alice);
        stable.deposit{value: 1 ether}();
        assertEq(stable.recoverableOf(alice), 1 ether);
    }

    function test_setPrice_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert("only owner");
        stable.setPrice(0.9e18);
    }

    function test_setPrice_depeg_dropsRecoverable() public {
        vm.prank(alice);
        stable.deposit{value: 1 ether}();
        stable.setPrice(0.9e18);
        assertEq(stable.price(), 0.9e18);
        assertEq(stable.recoverableOf(alice), 0.9 ether); // 10% depeg
    }

    function test_adapter_mirrorsRecoverable_atPegAndDepeg() public {
        vm.prank(alice);
        stable.deposit{value: 1 ether}();
        assertEq(adapter.positionOf(alice), stable.recoverableOf(alice)); // at peg
        stable.setPrice(0.9e18);
        assertEq(adapter.positionOf(alice), stable.recoverableOf(alice)); // after depeg
        assertEq(adapter.positionOf(alice), 0.9 ether);
    }
}
