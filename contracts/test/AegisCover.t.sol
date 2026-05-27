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

contract AegisCoverTest is Test {
    MockSomniaAgents agents;
    ConsensusOracle oracle;
    AegisCover cover;
    MockVault vault;
    MockVaultAdapter adapter;

    address alice = address(0xA11CE);
    uint64 constant YEAR = uint64(365 days);

    function setUp() public {
        agents = new MockSomniaAgents();
        oracle = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        cover = new AegisCover(oracle);
        vault = new MockVault();
        adapter = new MockVaultAdapter(address(vault));

        oracle.setConsumer(address(cover), true);
        cover.setAdapter(address(vault), IPositionAdapter(address(adapter)));

        vm.deal(address(oracle), 4 ether); // ~0.40 STT per request
        cover.fundPool{value: 1 ether}();
        vm.deal(alice, 10 ether);
    }

    // ---- helpers ----

    function _assess(address t, uint256 medianScore) internal {
        cover.requestRiskAssessment(t, hex"01"); // onlyOwner; test contract is owner
        int256[] memory s = new int256[](3);
        s[0] = int256(medianScore); s[1] = int256(medianScore); s[2] = int256(medianScore);
        agents.fulfill(agents.requestCount(), s);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        vault.deposit{value: amount}();
    }

    function _buy(address who, uint256 sum) internal returns (uint256 id) {
        uint256 premium = cover.quotePremium(address(vault), sum, YEAR);
        vm.prank(who);
        id = cover.buyPolicy{value: premium}(address(vault), AegisCover.CoverType.Exploit, sum, YEAR);
    }

    function _confirmExploit() internal {
        cover.requestCheck(address(vault), hex"de");
        int256[] memory s = new int256[](3);
        s[0] = 92; s[1] = 88; s[2] = 95; // median 92 >= 70
        agents.fulfill(agents.requestCount(), s);
    }

    // ---- pricing ----

    function test_assessment_cachesScoreAndRate() public {
        _assess(address(vault), 80);
        assertTrue(cover.riskAssessed(address(vault)));
        assertEq(cover.riskScore(address(vault)), 80);
        assertEq(cover.rateBps(address(vault)), 1_000); // High tier (>=67) -> 10%
    }

    function test_rateTiers_lowMediumHigh() public {
        _assess(address(vault), 20);
        assertEq(cover.rateBps(address(vault)), 300); // Low
        _assess(address(vault), 50);
        assertEq(cover.rateBps(address(vault)), 600); // Medium
        _assess(address(vault), 90);
        assertEq(cover.rateBps(address(vault)), 1_000); // High
    }

    function test_rateBps_revertsWhenNotAssessed() public {
        vm.expectRevert("not assessed");
        cover.rateBps(address(vault));
    }

    function test_quotePremium_annualHighTier() public {
        _assess(address(vault), 80); // 10%
        // 0.1 STT cover, 365d, 10% -> 0.01 STT
        assertEq(cover.quotePremium(address(vault), 0.1 ether, YEAR), 0.01 ether);
    }

    function test_requestRiskAssessment_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert("only owner");
        cover.requestRiskAssessment(address(vault), hex"01");
    }

    function test_setOracle_updatesAndOnlyOwner() public {
        ConsensusOracle o2 = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        cover.setOracle(o2);
        assertEq(address(cover.oracle()), address(o2));
        vm.prank(alice);
        vm.expectRevert("only owner");
        cover.setOracle(oracle);
    }

    // ---- buy ----

    function test_buyPolicy_requiresAssessment() public {
        _deposit(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert("not assessed");
        cover.buyPolicy{value: 0.01 ether}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);
    }

    function test_buyPolicy_requiresAdapter() public {
        _assess(address(0xBEEF), 80); // assessed but no adapter registered
        vm.prank(alice);
        vm.expectRevert("no adapter");
        cover.buyPolicy{value: 0.01 ether}(address(0xBEEF), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);
    }

    function test_buyPolicy_capsAtPosition() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert("over-insured");
        cover.buyPolicy{value: 0.02 ether}(address(vault), AegisCover.CoverType.Exploit, 0.2 ether, YEAR);
    }

    function test_buyPolicy_capsCumulativeAcrossPolicies() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        _buy(alice, 0.06 ether); // first policy ok (0.06 <= 0.1 position)

        // a SECOND 0.06 cover would exceed the position cumulatively (0.06 + 0.06 > 0.1)
        uint256 p = cover.quotePremium(address(vault), 0.06 ether, YEAR);
        vm.prank(alice);
        vm.expectRevert("over-insured");
        cover.buyPolicy{value: p}(address(vault), AegisCover.CoverType.Exploit, 0.06 ether, YEAR);

        // but 0.04 fits exactly (0.06 + 0.04 == 0.1)
        uint256 p2 = cover.quotePremium(address(vault), 0.04 ether, YEAR);
        vm.prank(alice);
        cover.buyPolicy{value: p2}(address(vault), AegisCover.CoverType.Exploit, 0.04 ether, YEAR);
        assertEq(cover.policyCount(), 2);
        assertEq(cover.coverByBuyerTarget(alice, address(vault)), 0.1 ether);
    }

    function test_buyPolicy_requiresExactPremium() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        vm.prank(alice);
        vm.expectRevert("bad premium");
        cover.buyPolicy{value: 0.02 ether}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);
    }

    function test_buyPolicy_recordsPolicy() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        uint256 premium = cover.quotePremium(address(vault), 0.1 ether, YEAR);

        vm.prank(alice);
        uint256 id = cover.buyPolicy{value: premium}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);

        assertEq(id, 0);
        assertEq(cover.policyCount(), 1);
        (
            address buyer,
            address t,
            AegisCover.CoverType ct,
            uint256 sum,
            uint256 prem,
            uint256 pos,
            ,
            ,
            AegisCover.PolicyStatus status
        ) = cover.policies(0);
        assertEq(buyer, alice);
        assertEq(t, address(vault));
        assertEq(uint8(ct), uint8(AegisCover.CoverType.Exploit));
        assertEq(sum, 0.1 ether);
        assertEq(prem, premium);
        assertEq(pos, 0.1 ether);
        assertEq(uint8(status), uint8(AegisCover.PolicyStatus.Active));
        assertEq(address(cover).balance, 1 ether + premium); // premium added to pool
    }

    // ---- loss-calc + claim ----

    function test_lossCalc_fullDrainPaysCoinsuredLoss() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        _buy(alice, 0.1 ether);

        vault.exploit(payable(address(0xBAD))); // recoverable -> 0
        assertEq(adapter.positionOf(alice), 0);

        _confirmExploit();

        assertTrue(cover.targetSettled(address(vault)));
        // loss 0.1, covered min(0.1,0.1)=0.1, payout 0.1 * 90% = 0.09
        assertEq(cover.claimable(alice), 0.09 ether);
    }

    function test_lossCalc_partialLossCappedByActualLoss() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        address bob = address(0xB0B);
        vm.deal(bob, 1 ether);
        _deposit(bob, 0.1 ether); // total 0.2
        _buy(alice, 0.1 ether);

        // simulate 50% loss: vault balance halved -> alice recoverable 0.05
        vm.deal(address(vault), 0.1 ether);
        assertEq(adapter.positionOf(alice), 0.05 ether);

        _confirmExploit();
        // loss 0.05, covered min(0.1,0.05)=0.05, payout 0.05 * 90% = 0.045
        assertEq(cover.claimable(alice), 0.045 ether);
    }

    function test_notConfirmed_noPayout() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        _buy(alice, 0.1 ether);
        vault.exploit(payable(address(0xBAD)));

        cover.requestCheck(address(vault), hex"de");
        int256[] memory s = new int256[](3);
        s[0] = 10; s[1] = 20; s[2] = 30; // median 20 < 70
        agents.fulfill(agents.requestCount(), s);

        assertFalse(cover.targetSettled(address(vault)));
        assertEq(cover.claimable(alice), 0);
    }

    function test_claim_transfersAndZeroes() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        _buy(alice, 0.1 ether);
        vault.exploit(payable(address(0xBAD)));
        _confirmExploit();

        uint256 before = alice.balance;
        vm.prank(alice);
        cover.claim();
        assertEq(alice.balance, before + 0.09 ether);
        assertEq(cover.claimable(alice), 0);
    }

    // ---- guards ----

    function test_onVerdict_onlyOracle() public {
        vm.expectRevert("only oracle");
        cover.onVerdict(keccak256("x"), 90, true);
    }

    function test_requestCheck_cooldown() public {
        cover.requestCheck(address(vault), hex"de");
        vm.expectRevert("cooldown");
        cover.requestCheck(address(vault), hex"de");
    }

    function test_settledTarget_blocksCheckAndBuy() public {
        _assess(address(vault), 80);
        _deposit(alice, 0.1 ether);
        _buy(alice, 0.1 ether);
        vault.exploit(payable(address(0xBAD)));
        _confirmExploit();
        assertTrue(cover.targetSettled(address(vault)));

        vm.warp(block.timestamp + cover.cooldown());
        vm.expectRevert("target settled");
        cover.requestCheck(address(vault), hex"de");

        _deposit(alice, 0.1 ether); // fresh position
        vm.prank(alice);
        vm.expectRevert("target settled");
        cover.buyPolicy{value: 0.01 ether}(address(vault), AegisCover.CoverType.Exploit, 0.1 ether, YEAR);
    }
}
