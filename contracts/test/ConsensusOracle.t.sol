// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConsensusOracle} from "../src/ConsensusOracle.sol";
import {MockSomniaAgents} from "../src/mocks/MockSomniaAgents.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {IVerdictConsumer} from "../src/interfaces/IVerdictConsumer.sol";

/// Records verdicts delivered by the oracle.
contract RecordingVerdictConsumer is IVerdictConsumer {
    bytes32 public lastQuestion;
    uint256 public lastScore;
    bool public lastConfirmed;
    uint256 public calls;

    function onVerdict(bytes32 questionId, uint256 score, bool confirmed) external {
        lastQuestion = questionId;
        lastScore = score;
        lastConfirmed = confirmed;
        calls++;
    }
}

// Minimal consumer that records the last verdict it received.
contract RecordingConsumer {
    bytes32 public lastQuestion;
    uint256 public lastScore;
    bool public lastConfirmed;
    function onVerdict(bytes32 q, uint256 s, bool c) external {
        lastQuestion = q; lastScore = s; lastConfirmed = c;
    }
}

contract ConsensusOracleTest is Test {
    // Redeclare oracle events locally so we can use vm.expectEmit without qualified-name restrictions.
    event VerdictFinalized(uint256 indexed requestId, bytes32 indexed questionId, uint256 score, bool confirmed);
    event VerdictFailed(uint256 indexed requestId, bytes32 indexed questionId, uint256 responseCount);

    MockSomniaAgents agents;
    ConsensusOracle oracle;
    RecordingVerdictConsumer consumer;

    bytes32 constant Q = keccak256("q1");

    function setUp() public {
        agents = new MockSomniaAgents();
        // agentId=42, subcommittee=5, minResponses=3, scoreThreshold=70, timeout=300
        oracle = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        consumer = new RecordingVerdictConsumer();
        oracle.setConsumer(address(consumer), true);
        vm.deal(address(oracle), 1 ether); // fund deposit balance
    }

    function test_requestVerdict_revertsForUnauthorized() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("not authorized");
        oracle.requestVerdict(Q, hex"01");
    }

    function test_requestVerdict_createsNativeRequest() public {
        vm.prank(address(consumer));
        uint256 id = oracle.requestVerdict(Q, hex"de");
        assertEq(id, 1);
        assertEq(agents.requestCount(), 1);
        (address c, bytes32 q, bool resolved) = oracle.pending(id);
        assertEq(c, address(consumer));
        assertEq(q, Q);
        assertEq(resolved, false);
    }

    function test_requestVerdict_revertsWhenUnderfunded() public {
        ConsensusOracle poor = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        poor.setConsumer(address(consumer), true);
        vm.prank(address(consumer));
        vm.expectRevert("insufficient deposit balance");
        poor.requestVerdict(Q, hex"de");
    }

    function test_requestVerdict_fundsFloorPlusReward() public {
        // mock floor = 0.03 ether (0.01*3); reward = 0.07*5 = 0.35; total expected 0.38
        // (subcommitteeSize is 5 in setUp)
        uint256 floor = agents.getAdvancedRequestDeposit(5);
        uint256 reward = agents.PER_AGENT_EXECUTION_COST() * 5;
        uint256 expected = floor + reward;
        // oracle must hold >= expected or revert
        ConsensusOracle poor = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        poor.setConsumer(address(consumer), true);
        vm.deal(address(poor), expected - 1);
        vm.prank(address(consumer));
        vm.expectRevert("insufficient deposit balance");
        poor.requestVerdict(Q, hex"de");
    }

    function _request() internal returns (uint256 id) {
        vm.prank(address(consumer));
        id = oracle.requestVerdict(Q, hex"de");
    }

    function test_handleResponse_confirmsWhenMedianAtOrAboveThreshold() public {
        uint256 id = _request();
        int256[] memory scores = new int256[](3);
        scores[0] = 90;
        scores[1] = 70;
        scores[2] = 80; // median 80 >= 70

        vm.expectEmit(true, true, false, true, address(oracle));
        emit VerdictFinalized(id, Q, 80, true);
        agents.fulfill(id, scores);

        assertEq(consumer.calls(), 1);
        assertEq(consumer.lastScore(), 80);
        assertTrue(consumer.lastConfirmed());
        (,, bool resolved) = oracle.pending(id);
        assertTrue(resolved);
    }

    function test_handleResponse_notConfirmedBelowThreshold() public {
        uint256 id = _request();
        int256[] memory scores = new int256[](3);
        scores[0] = 10;
        scores[1] = 60;
        scores[2] = 40; // median 40 < 70
        agents.fulfill(id, scores);

        assertEq(consumer.calls(), 1);
        assertEq(consumer.lastScore(), 40);
        assertFalse(consumer.lastConfirmed());
    }

    function test_handleResponse_insufficientResponses_failsNoCallback() public {
        uint256 id = _request();
        int256[] memory scores = new int256[](2); // < minResponses (3)
        scores[0] = 90;
        scores[1] = 95;

        vm.expectEmit(true, true, false, true, address(oracle));
        emit VerdictFailed(id, Q, 2);
        agents.fulfill(id, scores);

        assertEq(consumer.calls(), 0); // no verdict delivered
        (,, bool resolved) = oracle.pending(id);
        assertTrue(resolved); // still marked resolved (terminal)
    }

    function test_handleResponse_timedOutStatus_failsNoCallback() public {
        uint256 id = _request();
        int256[] memory scores = new int256[](3);
        scores[0] = 90;
        scores[1] = 90;
        scores[2] = 90;
        agents.fulfillWithStatus(id, scores, IAgentRequester.ResponseStatus.TimedOut);
        assertEq(consumer.calls(), 0);
    }

    function test_handleResponse_onlyAgentsCanCall() public {
        uint256 id = _request();
        IAgentRequester.Response[] memory empty = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory r;
        vm.expectRevert("only agents");
        oracle.handleResponse(id, empty, IAgentRequester.ResponseStatus.Success, r);
    }

    function test_handleResponse_doubleFulfillReverts() public {
        uint256 id = _request();
        int256[] memory scores = new int256[](3);
        scores[0] = 90;
        scores[1] = 80;
        scores[2] = 70;
        agents.fulfill(id, scores);
        // mock blocks a second fulfill of the same request
        vm.expectRevert("already fulfilled");
        agents.fulfill(id, scores);
    }

    function test_handleResponse_clampsOutOfRangeScores() public {
        uint256 id = _request();
        // model returns -5, 150, 80 -> clamp to 0, 100, 80 -> median 80 -> confirmed
        int256[] memory raw = new int256[](3);
        raw[0] = -5; raw[1] = 150; raw[2] = 80;
        agents.fulfill(id, raw);
        assertEq(consumer.lastScore(), 80);
        assertTrue(consumer.lastConfirmed());
    }

    function test_requestRiskVerdict_deliversMedianScore() public {
        RecordingConsumer riskConsumer = new RecordingConsumer();
        oracle.setConsumer(address(riskConsumer), true);
        vm.deal(address(oracle), 2 ether);

        vm.prank(address(riskConsumer));
        uint256 reqId = oracle.requestRiskVerdict(keccak256("risk-q"), bytes('{"protocol":"X"}'));

        int256[] memory scores = new int256[](3);
        scores[0] = 78; scores[1] = 80; scores[2] = 82; // median 80
        agents.fulfill(reqId, scores);

        assertEq(riskConsumer.lastScore(), 80);
        assertEq(riskConsumer.lastQuestion(), keccak256("risk-q"));
    }

    function test_handleResponse_directDoubleCallRevertsAlreadyResolved() public {
        uint256 id = _request();
        // Build Response array with int256-encoded results (verified live ABI).
        IAgentRequester.Response[] memory resp = new IAgentRequester.Response[](3);
        for (uint256 i; i < 3; i++) {
            resp[i] = IAgentRequester.Response({
                validator: address(uint160(i + 1)),
                result: abi.encode(int256(80)),   // int256 — verified live ABI
                status: IAgentRequester.ResponseStatus.Success,
                receipt: 0,
                timestamp: 0,
                executionCost: 0
            });
        }
        // Build the 15-field Request (only fields the oracle reads matter; rest zeroed).
        address[] memory subcommittee = new address[](0);
        IAgentRequester.Response[] memory emptyResp = new IAgentRequester.Response[](0);
        IAgentRequester.Request memory r = IAgentRequester.Request({
            id: id,
            requester: address(agents),
            callbackAddress: address(oracle),
            callbackSelector: bytes4(0),
            subcommittee: subcommittee,
            responses: emptyResp,
            responseCount: 3,
            failureCount: 0,
            threshold: 3,
            createdAt: block.timestamp,
            deadline: block.timestamp + 300,
            status: IAgentRequester.ResponseStatus.Success,
            consensusType: IAgentRequester.ConsensusType.Threshold,
            remainingBudget: 0,
            perAgentBudget: 0
        });
        vm.prank(address(agents));
        oracle.handleResponse(id, resp, IAgentRequester.ResponseStatus.Success, r); // delivers, marks resolved
        vm.prank(address(agents));
        vm.expectRevert("already resolved");
        oracle.handleResponse(id, resp, IAgentRequester.ResponseStatus.Success, r);
    }
}
