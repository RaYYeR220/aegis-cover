// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockSomniaAgents} from "../src/mocks/MockSomniaAgents.sol";
import {IAgentRequester, IAgentConsumer} from "../src/interfaces/IAgentRequester.sol";

/// Minimal consumer that records what the mock calls back with.
contract RecordingConsumer is IAgentConsumer {
    uint256 public lastRequestId;
    uint256 public lastCount;
    IAgentRequester.ResponseStatus public lastStatus;
    int256 public firstScore; // int256 — live ABI encodes inferNumber result as int256

    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory
    ) external {
        lastRequestId = requestId;
        lastCount = responses.length;
        lastStatus = status;
        if (responses.length > 0) {
            firstScore = abi.decode(responses[0].result, (int256));
        }
    }
}

contract MockSomniaAgentsTest is Test {
    MockSomniaAgents agents;
    RecordingConsumer consumer;

    function setUp() public {
        agents = new MockSomniaAgents();
        consumer = new RecordingConsumer();
    }

    function test_createAdvancedRequest_recordsAndReturnsId() public {
        uint256 deposit = agents.getAdvancedRequestDeposit(5);
        uint256 id = agents.createAdvancedRequest{value: deposit}(
            42,
            address(consumer),
            IAgentConsumer.handleResponse.selector,
            hex"01",
            5,
            3,
            IAgentRequester.ConsensusType.Threshold,
            300
        );
        assertEq(id, 1);
        assertEq(agents.requestCount(), 1);
    }

    function test_fulfill_callsBackWithScores() public {
        uint256 deposit = agents.getAdvancedRequestDeposit(5);
        uint256 id = agents.createAdvancedRequest{value: deposit}(
            42, address(consumer), IAgentConsumer.handleResponse.selector, hex"01", 5, 3, IAgentRequester.ConsensusType.Threshold, 300
        );

        int256[] memory scores = new int256[](3);
        scores[0] = 80;
        scores[1] = 75;
        scores[2] = 90;
        agents.fulfill(id, scores);

        assertEq(consumer.lastRequestId(), id);
        assertEq(consumer.lastCount(), 3);
        assertEq(uint256(consumer.lastStatus()), uint256(IAgentRequester.ResponseStatus.Success));
        assertEq(consumer.firstScore(), 80);
    }

    function test_depositFloor_basicRequest() public {
        // Basic request floor = 0.01 ether * 3 = 0.03 ether
        assertEq(agents.getRequestDeposit(), 0.03 ether);
    }

    function test_depositFloor_advancedRequest() public {
        // Advanced floor = 0.01 * subcommitteeSize
        assertEq(agents.getAdvancedRequestDeposit(5), 0.05 ether);
    }

    function test_perAgentExecutionCost() public {
        assertEq(agents.PER_AGENT_EXECUTION_COST(), 0.07 ether);
    }

    function test_depositTooLow_reverts() public {
        vm.expectRevert("deposit too low");
        agents.createAdvancedRequest{value: 0.001 ether}(
            42, address(consumer), IAgentConsumer.handleResponse.selector, hex"01", 5, 3, IAgentRequester.ConsensusType.Threshold, 300
        );
    }
}
