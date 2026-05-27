// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVault} from "../src/mocks/MockVault.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";

contract MockVaultAdapterTest is Test {
    MockVault vault;
    MockVaultAdapter adapter;
    address alice = address(0xA11CE);

    function setUp() public {
        vault = new MockVault();
        adapter = new MockVaultAdapter(address(vault));
        vm.deal(alice, 1 ether);
    }

    function test_positionOf_matchesRecoverable() public {
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        assertEq(adapter.positionOf(alice), 0.1 ether);
        vault.exploit(payable(address(0xBAD)));
        assertEq(adapter.positionOf(alice), 0);
    }
}
