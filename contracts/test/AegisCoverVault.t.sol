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

/// Reentrant claimant: on receiving its payout it tries to re-enter claim(). CEI + nonReentrant
/// must prevent a second payout. Doubles as a policy buyer so it can accrue a claim.
contract ReentrantClaimer {
    AegisCover public cover;
    MockVault public vault;
    bool public reentered;

    constructor(AegisCover _cover, MockVault _vault) {
        cover = _cover;
        vault = _vault;
    }

    function depositVault(uint256 amount) external {
        vault.deposit{value: amount}();
    }

    function buy(uint256 sum, uint64 duration) external {
        uint256 premium = cover.quotePremium(address(vault), sum, duration);
        cover.buyPolicy{value: premium}(address(vault), AegisCover.CoverType.Exploit, sum, duration);
    }

    function attack() external {
        cover.claim();
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            try cover.claim() {} catch {} // re-entry must be rejected; swallow so outer claim survives
        }
    }
}

contract AegisCoverVaultTest is Test {
    MockSomniaAgents agents;
    ConsensusOracle oracle;
    AegisCover cover;
    MockVault vault;
    MockVaultAdapter adapter;

    address lp1 = address(0x11);
    address lp2 = address(0x12);
    address alice = address(0xA11CE);
    uint64 constant YEAR = uint64(365 days);
    bytes32 constant EXPLOIT_KEY = keccak256("EXPLOIT");

    function setUp() public {
        agents = new MockSomniaAgents();
        oracle = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        cover = new AegisCover(oracle);
        vault = new MockVault();
        adapter = new MockVaultAdapter(address(vault));

        oracle.setConsumer(address(cover), true);
        cover.registerTarget(address(vault), IPositionAdapter(address(adapter)), EXPLOIT_KEY, "DemoVault");

        vm.deal(address(oracle), 4 ether);
        vm.deal(lp1, 100 ether);
        vm.deal(lp2, 100 ether);
        vm.deal(alice, 100 ether);

        _assess(address(vault), 80); // High tier → 10% annual
    }

    // ---- helpers ----

    function _assess(address t, uint256 score) internal {
        cover.requestRiskAssessment(t, hex"01");
        int256[] memory s = new int256[](3);
        s[0] = int256(score); s[1] = int256(score); s[2] = int256(score);
        agents.fulfill(agents.requestCount(), s);
    }

    function _lpDeposit(address who, uint256 amount) internal returns (uint256 sh) {
        vm.prank(who);
        sh = cover.deposit{value: amount}();
    }

    function _depositVault(address who, uint256 amount) internal {
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

    // ---- deposits / shares ----

    function test_firstDeposit_mintsShares() public {
        uint256 sh = _lpDeposit(lp1, 1 ether);
        assertGt(sh, 0);
        assertEq(cover.totalShares(), sh);
        assertEq(cover.shares(lp1), sh);
        assertEq(cover.freeAssets(), 1 ether);
    }

    function test_secondDeposit_proportional() public {
        uint256 s1 = _lpDeposit(lp1, 1 ether);
        uint256 s2 = _lpDeposit(lp2, 1 ether); // equal deposit, NAV unchanged → equal shares
        assertEq(s1, s2);
        assertEq(cover.totalShares(), s1 + s2);
        assertEq(cover.freeAssets(), 2 ether);
    }

    function test_premium_raisesNavForLPs() public {
        _lpDeposit(lp1, 1 ether);
        uint256 before = cover.previewValue(lp1);
        _depositVault(alice, 0.1 ether);
        _buy(alice, 0.1 ether); // premium 0.01 STT flows into the pool
        uint256 afterV = cover.previewValue(lp1);
        assertGt(afterV, before); // the sole LP captures the premium
    }

    // ---- loss socialization ----

    function test_payout_socializesLossToLPs() public {
        _lpDeposit(lp1, 1 ether);
        _depositVault(alice, 0.1 ether);
        _buy(alice, 0.1 ether);
        uint256 navBeforeLoss = cover.previewValue(lp1);

        vault.exploit(payable(address(0xBAD))); // alice's recoverable → 0
        _confirmExploit();

        assertEq(cover.claimable(alice), 0.09 ether); // loss 0.1 × 90% coinsurance
        uint256 navAfterLoss = cover.previewValue(lp1);
        assertLt(navAfterLoss, navBeforeLoss); // loss socialized to the LP

        // claimant pulls their payout
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        cover.claim();
        assertEq(alice.balance, aliceBefore + 0.09 ether);

        // LP can still withdraw the reduced value (full exit)
        uint256 lpBefore = lp1.balance;
        uint256 lpShares = cover.shares(lp1); // hoist getter out of the pranked call
        vm.prank(lp1);
        uint256 assets = cover.withdraw(lpShares);
        assertGt(assets, 0);
        assertEq(lp1.balance, lpBefore + assets);
        assertEq(cover.shares(lp1), 0);
    }

    // ---- capacity / solvency invariant ----

    function test_withdraw_blockedBelowLockedCapacity() public {
        _lpDeposit(lp1, 1 ether);
        _depositVault(alice, 0.5 ether);
        _buy(alice, 0.5 ether); // lockedCapacity = 0.45; freeAssets = 1.05
        uint256 lpShares = cover.shares(lp1); // hoist getter out of the pranked call
        vm.prank(lp1);
        vm.expectRevert("would under-collateralize");
        cover.withdraw(lpShares); // pulling everything drops free below the 0.45 lien
    }

    function test_buyPolicy_blockedWhenInsufficientCapacity() public {
        _lpDeposit(lp1, 0.1 ether); // thin pool
        _depositVault(alice, 1 ether); // big position, but the pool can't back it
        uint256 p = cover.quotePremium(address(vault), 1 ether, YEAR);
        vm.prank(alice);
        vm.expectRevert("insufficient capacity");
        cover.buyPolicy{value: p}(address(vault), AegisCover.CoverType.Exploit, 1 ether, YEAR);
    }

    function test_lockedCapacity_decrementsOnSettle() public {
        _lpDeposit(lp1, 1 ether);
        _depositVault(alice, 0.1 ether);
        _buy(alice, 0.1 ether);
        assertEq(cover.lockedCapacity(), 0.09 ether); // sumInsured 0.1 × 90%

        vault.exploit(payable(address(0xBAD)));
        _confirmExploit();
        assertEq(cover.lockedCapacity(), 0); // freed when the policy settles
    }

    // ---- donation / inflation attack ----

    function test_donationAttack_mitigated() public {
        address attacker = address(0xBAD511);
        address victim = address(0xC1C71A);
        vm.deal(attacker, 100 ether);
        vm.deal(victim, 100 ether);

        // attacker is the first depositor with 1 wei, then donates a large amount via receive()
        vm.prank(attacker);
        cover.deposit{value: 1}();
        assertEq(cover.totalShares(), 1);
        vm.prank(attacker);
        (bool ok,) = address(cover).call{value: 10 ether}(""); // donation, mints no shares
        assertTrue(ok);

        // victim deposit still mints non-zero shares worth ~their deposit (virtual offset holds)
        vm.prank(victim);
        uint256 vshares = cover.deposit{value: 1 ether}();
        assertGt(vshares, 0);
        uint256 vval = cover.previewValue(victim);
        assertGt(vval, 0.9 ether); // not stolen by the inflation attack
    }

    // ---- reentrancy ----

    function test_claim_reentrancy_safe() public {
        ReentrantClaimer attacker = new ReentrantClaimer(cover, vault);
        vm.deal(address(attacker), 100 ether);
        _lpDeposit(lp1, 1 ether); // back the pool

        attacker.depositVault(0.1 ether);
        attacker.buy(0.1 ether, YEAR);

        vault.exploit(payable(address(0xBAD)));
        _confirmExploit();
        assertEq(cover.claimable(address(attacker)), 0.09 ether);

        uint256 before = address(attacker).balance;
        attacker.attack(); // claim → payout transfer → receive() re-enters claim()
        assertTrue(attacker.reentered()); // reentry path executed
        assertEq(address(attacker).balance, before + 0.09 ether); // paid exactly once
        assertEq(cover.claimable(address(attacker)), 0);
        assertEq(cover.totalClaimable(), 0);
    }
}
