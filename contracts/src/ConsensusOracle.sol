// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAgentRequester, IAgentConsumer, ILLMInferenceAgent} from "./interfaces/IAgentRequester.sol";
import {AgentPrompt} from "./AgentPrompt.sol";
import {IVerdictConsumer} from "./interfaces/IVerdictConsumer.sol";
import {IConsensusOracle} from "./interfaces/IConsensusOracle.sol";

/// @notice Generic AI-consensus verdict primitive. Knows nothing about insurance.
/// Sends a question + evidence to Somnia's validator-run agents (Threshold mode),
/// reconciles the returned scores via median, and reports the verdict to a consumer.
contract ConsensusOracle is IAgentConsumer, IConsensusOracle {
    /// @notice Per-agent LLM inference reward, matches the live Somnia platform.
    uint256 public constant PER_AGENT_EXECUTION_COST = 0.07 ether;

    /// @notice Reserved system-prompt keys, seeded from AgentPrompt in the constructor.
    /// New perils are just a new key + setSystemPrompt — no redeploy.
    bytes32 public constant EXPLOIT_KEY = keccak256("EXPLOIT");
    bytes32 public constant RISK_KEY = keccak256("RISK");
    bytes32 public constant DEPEG_KEY = keccak256("DEPEG");
    // Extra peril presets — perils are data (added/tuned via setSystemPrompt, no redeploy).
    bytes32 public constant BRIDGE_KEY = keccak256("BRIDGE");
    bytes32 public constant SLASHING_KEY = keccak256("SLASHING");
    bytes32 public constant ORACLE_KEY = keccak256("ORACLE");
    bytes32 public constant GOVERNANCE_KEY = keccak256("GOVERNANCE");

    /// @notice Runtime-editable system prompts, keyed by peril. Storage is the source of truth at
    /// runtime; AgentPrompt holds the default texts seeded at deploy.
    mapping(bytes32 => string) public systemPromptOf;

    address public owner;
    IAgentRequester public immutable agents;

    uint256 public agentId;
    uint256 public subcommitteeSize; // e.g. 5
    uint256 public minResponses; // N required for a valid verdict, e.g. 3
    uint256 public scoreThreshold; // confirmed when median >= this, e.g. 70
    uint256 public timeout; // seconds passed to the native request

    mapping(address => bool) public authorizedConsumer;

    struct Pending {
        address consumer;
        bytes32 questionId;
        bool resolved;
    }

    mapping(uint256 => Pending) public pending; // requestId => Pending

    // ---------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------
    event ConsumerSet(address indexed consumer, bool allowed);
    event SystemPromptSet(bytes32 indexed key);
    event VerdictRequested(uint256 indexed requestId, address indexed consumer, bytes32 indexed questionId);
    event VerdictFinalized(uint256 indexed requestId, bytes32 indexed questionId, uint256 score, bool confirmed);
    /// The individual validator scores behind a verdict (after clamp), so consumers/UIs can show the
    /// real per-validator votes converging on the median — not just the final number.
    event ValidatorScores(uint256 indexed requestId, bytes32 indexed questionId, uint256[] scores);
    event VerdictFailed(uint256 indexed requestId, bytes32 indexed questionId, uint256 responseCount);
    event VerdictDeliveryFailed(uint256 indexed requestId, bytes32 indexed questionId);
    event ConfigUpdated(uint256 subcommitteeSize, uint256 minResponses, uint256 scoreThreshold, uint256 timeout);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    function setConsumer(address consumer, bool allowed) external onlyOwner {
        authorizedConsumer[consumer] = allowed;
        emit ConsumerSet(consumer, allowed);
    }

    /// @notice Owner reclaims unused native deposit balance (e.g. before swapping to a new oracle).
    function withdraw(address to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    function setAgentId(uint256 _agentId) external onlyOwner {
        agentId = _agentId;
    }

    /// @notice Set/replace the system prompt stored under `key`. Runtime-editable (no redeploy):
    /// tune a peril's prompt or add a brand-new peril by seeding a fresh key.
    function setSystemPrompt(bytes32 key, string calldata prompt) external override onlyOwner {
        systemPromptOf[key] = prompt;
        emit SystemPromptSet(key);
    }

    /// @notice Update oracle configuration. Only callable by owner.
    function setConfig(uint256 _subcommitteeSize, uint256 _minResponses, uint256 _scoreThreshold, uint256 _timeout)
        external
        onlyOwner
    {
        require(_minResponses > 0 && _minResponses <= _subcommitteeSize, "bad config");
        subcommitteeSize = _subcommitteeSize;
        minResponses = _minResponses;
        scoreThreshold = _scoreThreshold;
        timeout = _timeout;
        emit ConfigUpdated(_subcommitteeSize, _minResponses, _scoreThreshold, _timeout);
    }

    /// @notice Authorized consumer asks for a reconciled EXPLOIT verdict on `evidence`.
    /// Back-compat shim over the keyed store (reserved EXPLOIT_KEY).
    function requestVerdict(bytes32 questionId, bytes calldata evidence)
        external
        override
        returns (uint256 requestId)
    {
        require(authorizedConsumer[msg.sender], "not authorized");
        return _verdict(questionId, evidence, EXPLOIT_KEY);
    }

    /// @notice Authorized consumer asks for an adjudication using the prompt stored under `promptKey`.
    /// Routes per-peril (EXPLOIT / DEPEG / future perils) with no redeploy — the prompt is data.
    function requestVerdictFor(bytes32 questionId, bytes calldata evidence, bytes32 promptKey)
        external
        override
        returns (uint256 requestId)
    {
        require(authorizedConsumer[msg.sender], "not authorized");
        return _verdict(questionId, evidence, promptKey);
    }

    /// @notice Authorized consumer asks for a reconciled RISK score on protocol `facts`.
    /// Same median engine; the consumer interprets the median as a 0..100 risk score. Uses the
    /// risk user-prompt builder, framing `facts` as protocol facts rather than incident evidence.
    function requestRiskVerdict(bytes32 questionId, bytes calldata facts)
        external
        override
        returns (uint256 requestId)
    {
        require(authorizedConsumer[msg.sender], "not authorized");
        string memory system = systemPromptOf[RISK_KEY];
        require(bytes(system).length > 0, "no prompt");
        return _request(questionId, AgentPrompt.buildRiskPrompt(facts), system);
    }

    /// @dev Shared evidence-verdict path: resolve the keyed system prompt, then dispatch.
    /// Auth is enforced by callers (msg.sender-dependent).
    function _verdict(bytes32 questionId, bytes calldata evidence, bytes32 promptKey)
        private
        returns (uint256 requestId)
    {
        string memory system = systemPromptOf[promptKey];
        require(bytes(system).length > 0, "no prompt");
        return _request(questionId, AgentPrompt.buildPrompt(evidence), system);
    }

    /// @dev Shared request builder: deposit check + payload + native createAdvancedRequest.
    function _request(bytes32 questionId, string memory prompt, string memory system)
        private
        returns (uint256 requestId)
    {
        uint256 deposit = agents.getAdvancedRequestDeposit(subcommitteeSize) + PER_AGENT_EXECUTION_COST * subcommitteeSize;
        require(address(this).balance >= deposit, "insufficient deposit balance");

        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferNumber.selector,
            prompt,
            system,
            int256(0),
            int256(100),
            false // chainOfThought off (cheaper/tighter; Threshold+median tolerates variance)
        );

        requestId = agents.createAdvancedRequest{value: deposit}(
            agentId,
            address(this),
            IAgentConsumer.handleResponse.selector,
            payload,
            subcommitteeSize,
            minResponses,
            IAgentRequester.ConsensusType.Threshold,
            timeout
        );

        pending[requestId] = Pending({consumer: msg.sender, questionId: questionId, resolved: false});
        emit VerdictRequested(requestId, msg.sender, questionId);
    }

    constructor(
        IAgentRequester _agents,
        uint256 _agentId,
        uint256 _subcommitteeSize,
        uint256 _minResponses,
        uint256 _scoreThreshold,
        uint256 _timeout
    ) {
        require(_minResponses > 0 && _minResponses <= _subcommitteeSize, "bad config");
        owner = msg.sender;
        agents = _agents;
        agentId = _agentId;
        subcommitteeSize = _subcommitteeSize;
        minResponses = _minResponses;
        scoreThreshold = _scoreThreshold;
        timeout = _timeout;

        // Seed the reserved prompts from AgentPrompt so legacy call sites and existing tests work
        // with zero extra wiring. setSystemPrompt edits these at runtime, no redeploy.
        systemPromptOf[EXPLOIT_KEY] = AgentPrompt.SYSTEM();
        systemPromptOf[RISK_KEY] = AgentPrompt.RISK_SYSTEM();
        systemPromptOf[DEPEG_KEY] = AgentPrompt.DEPEG_SYSTEM();
        systemPromptOf[BRIDGE_KEY] = AgentPrompt.BRIDGE_SYSTEM();
        systemPromptOf[SLASHING_KEY] = AgentPrompt.SLASHING_SYSTEM();
        systemPromptOf[ORACLE_KEY] = AgentPrompt.ORACLE_SYSTEM();
        systemPromptOf[GOVERNANCE_KEY] = AgentPrompt.GOVERNANCE_SYSTEM();
    }

    /// @dev Median of a memory array. Sorts in place (insertion sort; arrays are tiny).
    /// Odd length -> middle element; even -> integer division of the two middle elements
    /// (FLOOR of the true median). For even-length arrays this returns the FLOOR of the
    /// true median (integer division), so configure `scoreThreshold` accordingly;
    /// an odd `subcommitteeSize` avoids the tie case entirely.
    function _median(uint256[] memory a) internal pure returns (uint256) {
        uint256 len = a.length;
        require(len > 0, "empty");
        for (uint256 i = 1; i < len; i++) {
            uint256 key = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > key) {
                a[j] = a[j - 1];
                j--;
            }
            a[j] = key;
        }
        if (len % 2 == 1) {
            return a[len / 2];
        }
        return (a[len / 2 - 1] + a[len / 2]) / 2;
    }

    /// @notice Native callback. Only the agents contract may call it.
    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory
    ) external override {
        require(msg.sender == address(agents), "only agents");
        Pending storage p = pending[requestId];
        require(p.consumer != address(0), "unknown request");
        require(!p.resolved, "already resolved");
        p.resolved = true; // effects before any external call (reentrancy-safe)

        // Collect scores from successful validator responses.
        uint256[] memory scores = new uint256[](responses.length);
        uint256 n;
        for (uint256 i; i < responses.length; i++) {
            if (responses[i].status == IAgentRequester.ResponseStatus.Success && responses[i].result.length >= 32) {
                int256 raw = abi.decode(responses[i].result, (int256));
                if (raw < 0) raw = 0;
                if (raw > 100) raw = 100;
                scores[n++] = uint256(raw);
            }
        }

        // `status` is the native aggregate status from the requester; `n` is the count
        // of individually-successful responses the oracle collected from validators.
        if (status != IAgentRequester.ResponseStatus.Success || n < minResponses) {
            emit VerdictFailed(requestId, p.questionId, n);
            return; // inconclusive; consumer can re-trigger
        }

        uint256[] memory trimmed = new uint256[](n);
        for (uint256 i; i < n; i++) {
            trimmed[i] = scores[i];
        }

        uint256 m = _median(trimmed);
        bool confirmed = m >= scoreThreshold;
        emit ValidatorScores(requestId, p.questionId, trimmed);
        emit VerdictFinalized(requestId, p.questionId, m, confirmed);
        try IVerdictConsumer(p.consumer).onVerdict(p.questionId, m, confirmed) {}
        catch {
            emit VerdictDeliveryFailed(requestId, p.questionId);
        }
    }

    receive() external payable {}
}
