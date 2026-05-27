// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisCover} from "../src/AegisCover.sol";
import {ConsensusOracle} from "../src/ConsensusOracle.sol";
import {MockSomniaAgents} from "../src/mocks/MockSomniaAgents.sol";
import {MockVault} from "../src/mocks/MockVault.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {IPositionAdapter} from "../src/interfaces/IPositionAdapter.sol";

contract IntegrationTest is Test {
    MockSomniaAgents agents;
    ConsensusOracle oracle;
    AegisCover cover;
    MockVault vault;
    MockVaultAdapter adapter;

    address alice = address(0xA11CE);
    address attacker = address(0xBAD);
    uint64 constant YEAR = uint64(365 days);

    function setUp() public {
        agents = new MockSomniaAgents();
        oracle = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        cover = new AegisCover(oracle);
        vault = new MockVault();
        adapter = new MockVaultAdapter(address(vault));

        oracle.setConsumer(address(cover), true);
        cover.setAdapter(address(vault), IPositionAdapter(address(adapter)));

        vm.deal(address(oracle), 4 ether); // deposit balance for 2 requests
        cover.fundPool{value: 1 ether}();
        vm.deal(alice, 10 ether);
    }

    function test_fullLifecycle_assessBuyExploitLossCalcClaim() public {
        // 1. Periodic keeper assessment -> cache risk score (median 80 = High tier).
        cover.requestRiskAssessment(address(vault), bytes('{"protocol":"MockVault","audit":"none"}'));
        int256[] memory rs = new int256[](5);
        rs[0] = 82; rs[1] = 78; rs[2] = 80; rs[3] = 85; rs[4] = 76; // median 80
        agents.fulfill(agents.requestCount(), rs);
        assertEq(cover.riskScore(address(vault)), 80);
        assertEq(cover.rateBps(address(vault)), 1_000);

        // 2. Alice has a 0.1 STT position and insures all of it for a year.
        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        uint256 premium = cover.quotePremium(address(vault), 0.1 ether, YEAR);
        assertEq(premium, 0.01 ether);
        vm.prank(alice);
        cover.buyPolicy{value: premium}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);

        // 3. The vault is exploited (staged drain).
        vault.exploit(payable(attacker));
        assertEq(vault.tvl(), 0);

        // 4. Watcher nudges a check; validator subcommittee confirms (median >= 70).
        bytes memory evidence = abi.encode(address(vault), uint256(0.1 ether), uint256(0));
        cover.requestCheck(address(vault), evidence);
        int256[] memory scores = new int256[](5);
        scores[0] = 92; scores[1] = 88; scores[2] = 95; scores[3] = 90; scores[4] = 91;
        agents.fulfill(agents.requestCount(), scores);

        // 5. Loss-calc: 0.1 -> 0, loss 0.1, coinsurance 90% -> 0.09.
        assertTrue(cover.targetSettled(address(vault)));
        assertEq(cover.claimable(alice), 0.09 ether);

        // 6. Alice claims.
        uint256 before = alice.balance;
        vm.prank(alice);
        cover.claim();
        assertEq(alice.balance, before + 0.09 ether);
    }

    function test_fullLifecycle_falseAlarmNoPayout() public {
        cover.requestRiskAssessment(address(vault), bytes('{"protocol":"MockVault"}'));
        int256[] memory rs = new int256[](3);
        rs[0] = 80; rs[1] = 80; rs[2] = 80;
        agents.fulfill(agents.requestCount(), rs);

        vm.prank(alice);
        vault.deposit{value: 0.1 ether}();
        uint256 premium = cover.quotePremium(address(vault), 0.1 ether, YEAR);
        vm.prank(alice);
        cover.buyPolicy{value: premium}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);

        // A benign dip: validators score low.
        cover.requestCheck(address(vault), abi.encode(address(vault), uint256(0.1 ether), uint256(0.098 ether)));
        int256[] memory scores = new int256[](3);
        scores[0] = 5; scores[1] = 15; scores[2] = 25; // median 15 < 70
        agents.fulfill(agents.requestCount(), scores);

        assertFalse(cover.targetSettled(address(vault)));
        assertEq(cover.claimable(alice), 0);
    }
}
