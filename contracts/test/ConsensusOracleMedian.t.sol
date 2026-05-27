// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConsensusOracle} from "../src/ConsensusOracle.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";

/// Exposes the internal _median via a public wrapper for testing.
contract MedianHarness is ConsensusOracle {
    constructor()
        ConsensusOracle(IAgentRequester(address(0xdead)), 1, 5, 3, 70, 300)
    {}

    function median(uint256[] memory a) external pure returns (uint256) {
        return _median(a);
    }
}

contract ConsensusOracleMedianTest is Test {
    MedianHarness h;

    function setUp() public {
        h = new MedianHarness();
    }

    function test_oddCount_returnsMiddle() public view {
        uint256[] memory a = new uint256[](3);
        a[0] = 90;
        a[1] = 10;
        a[2] = 50;
        assertEq(h.median(a), 50);
    }

    function test_evenCount_returnsAverageOfMiddleTwo() public view {
        uint256[] memory a = new uint256[](4);
        a[0] = 40;
        a[1] = 10;
        a[2] = 30;
        a[3] = 20; // sorted: 10,20,30,40 -> (20+30)/2 = 25
        assertEq(h.median(a), 25);
    }

    function test_single() public view {
        uint256[] memory a = new uint256[](1);
        a[0] = 77;
        assertEq(h.median(a), 77);
    }

    function test_outlierDoesNotMoveMedianMuch() public view {
        // four honest ~80, one malicious 0 -> sorted 0,79,80,81,82 -> median 80
        uint256[] memory a = new uint256[](5);
        a[0] = 80;
        a[1] = 0;
        a[2] = 81;
        a[3] = 79;
        a[4] = 82;
        assertEq(h.median(a), 80);
    }
}
