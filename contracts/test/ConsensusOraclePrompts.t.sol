// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConsensusOracle} from "../src/ConsensusOracle.sol";
import {AgentPrompt} from "../src/AgentPrompt.sol";
import {MockSomniaAgents} from "../src/mocks/MockSomniaAgents.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";

/// Prompts-in-storage: the oracle keeps system prompts in a keyed mapping so new perils are
/// `setSystemPrompt` (data), not a redeploy. `requestVerdictFor` routes by key; the legacy
/// `requestVerdict`/`requestRiskVerdict` keep working via reserved EXPLOIT/RISK keys.
contract ConsensusOraclePromptsTest is Test {
    MockSomniaAgents agents;
    ConsensusOracle oracle;
    address consumer = address(0xC0FFEE);

    bytes32 constant Q = keccak256("q1");
    bytes32 constant CUSTOM = keccak256("CUSTOM_PERIL");

    function setUp() public {
        agents = new MockSomniaAgents();
        // agentId=42, subcommittee=5, minResponses=3, scoreThreshold=70, timeout=300
        oracle = new ConsensusOracle(IAgentRequester(address(agents)), 42, 5, 3, 70, 300);
        oracle.setConsumer(consumer, true);
        vm.deal(address(oracle), 2 ether); // fund deposit balance
    }

    // (a) setSystemPrompt is onlyOwner and stores ----------------------------------------------
    function test_setSystemPrompt_onlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("only owner");
        oracle.setSystemPrompt(CUSTOM, "hello");
    }

    function test_setSystemPrompt_stores() public {
        oracle.setSystemPrompt(CUSTOM, "custom-system-text");
        assertEq(oracle.systemPromptOf(CUSTOM), "custom-system-text");
    }

    // (b) requestVerdictFor revert paths -------------------------------------------------------
    function test_requestVerdictFor_revertsNoPromptWhenUnseeded() public {
        vm.prank(consumer);
        vm.expectRevert("no prompt");
        oracle.requestVerdictFor(Q, hex"de", CUSTOM); // key never seeded
    }

    function test_requestVerdictFor_revertsUnauthorized() public {
        bytes32 ek = oracle.EXPLOIT_KEY(); // hoist getter out so the prank lands on requestVerdictFor
        vm.prank(address(0xBEEF));
        vm.expectRevert("not authorized");
        oracle.requestVerdictFor(Q, hex"de", ek);
    }

    // (c) succeeds + records pending after seed + auth -----------------------------------------
    function test_requestVerdictFor_succeedsAndRecordsPending() public {
        oracle.setSystemPrompt(CUSTOM, "custom-system-text");
        vm.prank(consumer);
        uint256 id = oracle.requestVerdictFor(Q, hex"de", CUSTOM);
        assertEq(id, 1);
        assertEq(agents.requestCount(), 1);
        (address c, bytes32 q, bool resolved) = oracle.pending(id);
        assertEq(c, consumer);
        assertEq(q, Q);
        assertFalse(resolved);
    }

    // (d) reserved keys seeded in constructor; back-compat methods still work -------------------
    function test_reservedKeys_seededInConstructor() public view {
        assertEq(oracle.systemPromptOf(oracle.EXPLOIT_KEY()), AgentPrompt.SYSTEM());
        assertEq(oracle.systemPromptOf(oracle.RISK_KEY()), AgentPrompt.RISK_SYSTEM());
        assertEq(oracle.systemPromptOf(oracle.DEPEG_KEY()), AgentPrompt.DEPEG_SYSTEM());
    }

    function test_extraPerilKeys_seededInConstructor() public view {
        assertEq(oracle.systemPromptOf(oracle.BRIDGE_KEY()), AgentPrompt.BRIDGE_SYSTEM());
        assertEq(oracle.systemPromptOf(oracle.SLASHING_KEY()), AgentPrompt.SLASHING_SYSTEM());
        assertEq(oracle.systemPromptOf(oracle.ORACLE_KEY()), AgentPrompt.ORACLE_SYSTEM());
        assertEq(oracle.systemPromptOf(oracle.GOVERNANCE_KEY()), AgentPrompt.GOVERNANCE_SYSTEM());
    }

    function test_requestVerdict_backCompatStillWorks() public {
        vm.prank(consumer);
        uint256 id = oracle.requestVerdict(Q, hex"de");
        assertEq(id, 1);
        (address c,,) = oracle.pending(id);
        assertEq(c, consumer);
    }

    function test_requestRiskVerdict_backCompatStillWorks() public {
        vm.prank(consumer);
        uint256 id = oracle.requestRiskVerdict(Q, bytes('{"protocol":"X"}'));
        assertEq(id, 1);
        (address c,,) = oracle.pending(id);
        assertEq(c, consumer);
    }

    function test_depegKey_routesViaRequestVerdictFor() public {
        bytes32 dk = oracle.DEPEG_KEY(); // hoist getter out so the prank lands on requestVerdictFor
        vm.prank(consumer);
        uint256 id = oracle.requestVerdictFor(Q, hex"de", dk);
        assertEq(id, 1);
        (address c,,) = oracle.pending(id);
        assertEq(c, consumer);
    }
}
