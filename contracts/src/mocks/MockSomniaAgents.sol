// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAgentRequester, IAgentConsumer} from "../interfaces/IAgentRequester.sol";

/// @notice Deterministic test double for the native Somnia agent requester.
/// Records requests; tests trigger the async callback via fulfill*/timeout helpers.
/// Updated to match the verified live ABI (2026-05-22):
///   - _callback builds the real 15-field Request struct
///   - Response.result is abi.encode(int256(score))
///   - getRequestDeposit() / getAdvancedRequestDeposit() return the reserve floor
///   - PER_AGENT_EXECUTION_COST() returns 0.07 ether (per-agent reward headroom)
contract MockSomniaAgents is IAgentRequester {
    /// @notice Per-agent execution cost (LLM inference reward), matches live platform.
    uint256 public constant PER_AGENT_EXECUTION_COST = 0.07 ether;

    /// @notice Reserve floor per runner (matches live platform: 0.01 STT each).
    uint256 public constant FLOOR_PER_RUNNER = 0.01 ether;

    /// @notice Default subcommittee size used by createRequest (basic call).
    uint256 public constant DEFAULT_SUBCOMMITTEE = 3;

    uint256 public requestCount;

    struct Stored {
        uint256 agentId;
        address callbackAddress;
        bytes4 callbackSelector;
        bytes payload;
        uint256 subcommitteeSize;
        uint256 threshold;
        bool fulfilled;
    }

    mapping(uint256 => Stored) public requests;

    // -------------------------------------------------------------------------
    // IAgentRequester: deposit queries
    // -------------------------------------------------------------------------

    /// @notice Reserve floor for a basic (default subcommittee = 3) request.
    function getRequestDeposit() external pure returns (uint256) {
        return FLOOR_PER_RUNNER * DEFAULT_SUBCOMMITTEE;
    }

    /// @notice Reserve floor for an advanced request with the given subcommittee size.
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external pure returns (uint256) {
        return FLOOR_PER_RUNNER * subcommitteeSize;
    }

    // -------------------------------------------------------------------------
    // IAgentRequester: request creation
    // -------------------------------------------------------------------------

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        return _store(agentId, callbackAddress, callbackSelector, payload, DEFAULT_SUBCOMMITTEE, DEFAULT_SUBCOMMITTEE);
    }

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType,
        uint256
    ) external payable returns (uint256 requestId) {
        return _store(agentId, callbackAddress, callbackSelector, payload, subcommitteeSize, threshold);
    }

    function _store(
        uint256 agentId,
        address cb,
        bytes4 sel,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold
    ) internal returns (uint256 requestId) {
        uint256 floor = FLOOR_PER_RUNNER * subcommitteeSize;
        require(msg.value >= floor, "deposit too low");
        requestId = ++requestCount;
        requests[requestId] = Stored(agentId, cb, sel, payload, subcommitteeSize, threshold, false);
    }

    // -------------------------------------------------------------------------
    // Test helpers: drive the async callback
    // -------------------------------------------------------------------------

    /// @notice Simulate a successful Threshold round. Scores are int256 (live ABI).
    function fulfill(uint256 requestId, int256[] calldata scores) external {
        _callback(requestId, scores, ResponseStatus.Success);
    }

    /// @notice Simulate an overall status (e.g. TimedOut) with whatever scores responded.
    function fulfillWithStatus(uint256 requestId, int256[] calldata scores, ResponseStatus overall) external {
        _callback(requestId, scores, overall);
    }

    // -------------------------------------------------------------------------
    // Internal callback builder
    // -------------------------------------------------------------------------

    function _callback(uint256 requestId, int256[] calldata scores, ResponseStatus overall) internal {
        Stored storage s = requests[requestId];
        require(s.callbackAddress != address(0), "no request");
        require(!s.fulfilled, "already fulfilled");
        s.fulfilled = true;

        // Build synthetic validator addresses (matches previous convention).
        address[] memory subcommittee = new address[](s.subcommitteeSize);
        for (uint256 i; i < s.subcommitteeSize; i++) {
            subcommittee[i] = address(uint160(0xA11CE + i));
        }

        // Build Response array: encode each score as int256 (live ABI).
        Response[] memory responses = new Response[](scores.length);
        for (uint256 i; i < scores.length; i++) {
            responses[i] = Response({
                validator: address(uint160(0xA11CE + i)),
                result: abi.encode(scores[i]),      // int256-encoded result
                status: ResponseStatus.Success,
                receipt: i,
                timestamp: block.timestamp,
                executionCost: PER_AGENT_EXECUTION_COST
            });
        }

        // Build the real 15-field Request (on-chain consensus state).
        Request memory details = Request({
            id: requestId,
            requester: address(this),
            callbackAddress: s.callbackAddress,
            callbackSelector: s.callbackSelector,
            subcommittee: subcommittee,
            responses: responses,
            responseCount: scores.length,
            failureCount: 0,
            threshold: s.threshold,
            createdAt: block.timestamp,
            deadline: block.timestamp + 300,
            status: overall,
            consensusType: ConsensusType.Threshold,
            remainingBudget: 0,
            perAgentBudget: PER_AGENT_EXECUTION_COST
        });

        (bool ok,) = s.callbackAddress.call(
            abi.encodeWithSelector(IAgentConsumer.handleResponse.selector, requestId, responses, overall, details)
        );
        require(ok, "callback failed");
    }
}
