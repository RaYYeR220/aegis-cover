// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IConsensusOracle} from "./interfaces/IConsensusOracle.sol";
import {IVerdictConsumer} from "./interfaces/IVerdictConsumer.sol";
import {IPositionAdapter} from "./interfaces/IPositionAdapter.sol";

/// @notice Autonomous parametric cover, v2. Variable, agent-priced policies with a
/// deterministic on-chain loss-calc + coinsurance at settlement.
///
/// One consensus engine (ConsensusOracle), two jobs:
///   1. PRICING — keeper-triggered (periodic) risk assessment: validators score a
///      target's risk (median 0..100), cached on-chain; quotes read the cache (instant).
///   2. CLAIM — on a confirmed exploit verdict, pay each holder
///      min(sumInsured, positionAtPurchase - positionNow) * coinsurance. Never more
///      than they actually lost (kills the over-payment / moral-hazard hole).
contract AegisCover is IVerdictConsumer, ReentrancyGuard {
    // ---- types ----
    enum CoverType { Exploit, Depeg, Bridge, Slashing, Oracle, Governance }
    enum PolicyStatus { Active, Settled, Expired }
    enum QuestionKind { None, Claim, Pricing }

    struct Policy {
        address buyer;
        address target;
        CoverType coverType;
        uint256 sumInsured;
        uint256 premiumPaid;
        uint256 positionAtPurchase;
        uint64 start;
        uint64 duration; // seconds
        PolicyStatus status;
    }

    /// @notice A catalog entry: which adapter reads positions, which peril prompt adjudicates a
    /// claim, whether the listing is open, and a human label. Adding a protocol is registerTarget;
    /// adding a peril is a new oracle prompt key — neither needs a redeploy.
    struct Listing {
        IPositionAdapter adapter;
        bytes32 perilKey;
        bool active;
        string name;
    }

    // ---- constants ----
    uint256 public constant BPS = 10_000;
    uint256 public constant COINSURANCE_BPS = 9_000; // 90% — holder keeps 10% skin in the game
    uint256 public constant YEAR = 365 days;
    /// @notice Default peril key for unregistered targets — matches ConsensusOracle.EXPLOIT_KEY.
    bytes32 public constant EXPLOIT_KEY = keccak256("EXPLOIT");
    /// @notice Virtual shares+assets offset that neutralizes the first-depositor inflation /
    /// donation attack (a victim deposit always mints meaningful shares). See test_donationAttack.
    uint256 private constant VIRTUAL = 1e3;

    // ---- config / wiring ----
    address public owner;
    IConsensusOracle public oracle;
    uint256 public cooldown = 1 minutes;

    // ---- policy storage ----
    Policy[] public policies;
    mapping(address => uint256[]) public policiesByTarget;
    mapping(address => uint256) public lastCheck; // target => timestamp
    mapping(address => bool) public targetSettled;
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;
    uint256 public checkNonce;

    // ---- LP underwriting vault ----
    /// @dev LPs deposit STT for shares of the pool; premiums accrue to share value, payouts are
    /// socialized across shares. `lockedCapacity` is the Σ maxPayout of active policies — a lien
    /// that capital can't be withdrawn below and new cover can't be sold past (solvency invariant).
    uint256 public totalShares;
    mapping(address => uint256) public shares;
    uint256 public lockedCapacity;

    // ---- position adapters (per target) ----
    mapping(address => IPositionAdapter) public adapter;

    // ---- catalog / registry ----
    mapping(address => Listing) public listing; // target => catalog entry
    address[] public listedTargets;             // enumerable catalog
    mapping(address => bool) private _listed;    // dedupe guard for listedTargets

    // ---- risk pricing cache (per target) ----
    mapping(address => uint256) public riskScore;     // last agent median, 0..100
    mapping(address => uint64) public riskAssessedAt; // timestamp of last assessment
    mapping(address => bool) public riskAssessed;     // has a cached score

    // ---- in-flight oracle questions ----
    mapping(bytes32 => QuestionKind) public questionKind; // questionId => kind (None when closed)
    mapping(bytes32 => address) public questionTarget;    // questionId => target

    // ---- per-buyer cumulative cover (per target) ----
    /// @dev Total sumInsured a buyer holds on a target. Caps cumulative cover at their
    /// position so a holder can't buy N policies on the same position and collect N x the loss.
    mapping(address => mapping(address => uint256)) public coverByBuyerTarget;

    // ---- events ----
    event PoolFunded(address indexed from, uint256 amount);
    event AdapterSet(address indexed target, address adapter);
    event TargetRegistered(address indexed target, address adapter, bytes32 perilKey, string name);
    event TargetActiveSet(address indexed target, bool active);
    event OracleSet(address indexed oracle);
    event RiskAssessmentRequested(bytes32 indexed questionId, address indexed target, uint256 requestId);
    event RiskAssessed(address indexed target, uint256 score, uint256 rateBps);
    event PolicyBought(
        uint256 indexed policyId,
        address indexed buyer,
        address indexed target,
        uint8 coverType,
        uint256 sumInsured,
        uint256 premium
    );
    event CheckRequested(bytes32 indexed questionId, address indexed target, uint256 requestId);
    event VerdictReceived(bytes32 indexed questionId, address indexed target, uint256 score, bool confirmed);
    event PolicySettled(uint256 indexed policyId, address indexed buyer, uint256 loss, uint256 payout);
    event Payout(address indexed target, uint256 totalCredited, uint256 policiesPaid);
    event Claimed(address indexed buyer, uint256 amount);
    event CooldownUpdated(uint256 cooldown);
    event Deposited(address indexed lp, uint256 assets, uint256 sharesMinted);
    event Withdrawn(address indexed lp, uint256 assets, uint256 sharesBurned);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(IConsensusOracle _oracle) {
        owner = msg.sender;
        oracle = _oracle;
    }

    // ---- admin ----

    function setCooldown(uint256 _cooldown) external onlyOwner {
        cooldown = _cooldown;
        emit CooldownUpdated(_cooldown);
    }

    function setAdapter(address target, IPositionAdapter a) external onlyOwner {
        adapter[target] = a;
        emit AdapterSet(target, address(a));
    }

    /// @notice List a protocol in the catalog: wire its adapter, route its claims through `perilKey`,
    /// and surface it (label + enumerable). Idempotent — re-registering updates in place, never
    /// duplicates the enumeration. Curated for now (onlyOwner); loosen to open listing without redeploy.
    function registerTarget(address target, IPositionAdapter a, bytes32 perilKey, string calldata name)
        external
        onlyOwner
    {
        adapter[target] = a;
        listing[target] = Listing({adapter: a, perilKey: perilKey, active: true, name: name});
        if (!_listed[target]) {
            _listed[target] = true;
            listedTargets.push(target);
        }
        emit AdapterSet(target, address(a));
        emit TargetRegistered(target, address(a), perilKey, name);
    }

    function setTargetActive(address target, bool active) external onlyOwner {
        listing[target].active = active;
        emit TargetActiveSet(target, active);
    }

    function listedTargetsCount() external view returns (uint256) {
        return listedTargets.length;
    }

    /// @dev Peril key routing a target's claim adjudication. Unregistered (perilKey == 0) → EXPLOIT.
    function _perilKeyOf(address target) internal view returns (bytes32) {
        bytes32 k = listing[target].perilKey;
        return k == bytes32(0) ? EXPLOIT_KEY : k;
    }

    /// @notice Repoint the cover at a new oracle (e.g. to ship an improved risk prompt)
    /// without redeploying the cover — policies and the risk cache are preserved.
    function setOracle(IConsensusOracle _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleSet(address(_oracle));
    }

    function policyCount() external view returns (uint256) {
        return policies.length;
    }

    function fundPool() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }

    // ---- LP underwriting vault ----

    /// @notice Capital available to LPs and to back policies: pool balance minus money already
    /// owed to claimants. This is the NAV the LP shares are priced against.
    function freeAssets() public view returns (uint256) {
        return address(this).balance - totalClaimable;
    }

    /// @notice Maximum payout a policy of `sumInsured` can ever cost the pool (coinsured loss cap).
    function _maxPayout(uint256 sumInsured) internal pure returns (uint256) {
        return sumInsured * COINSURANCE_BPS / BPS;
    }

    /// @notice Deposit STT as an underwriter; mint pool shares against current NAV. The incoming
    /// msg.value is already in `balance`, so we subtract it to price against the pre-deposit NAV.
    function deposit() external payable nonReentrant returns (uint256 s) {
        require(msg.value > 0, "zero deposit");
        uint256 base = address(this).balance - msg.value - totalClaimable; // free assets pre-deposit
        s = totalShares == 0 ? msg.value : msg.value * (totalShares + VIRTUAL) / (base + VIRTUAL);
        require(s > 0, "no shares");
        totalShares += s;
        shares[msg.sender] += s;
        emit Deposited(msg.sender, msg.value, s);
    }

    /// @notice Burn `s` shares and withdraw their NAV — but never below the locked-capacity lien.
    function withdraw(uint256 s) external nonReentrant returns (uint256 assets) {
        require(s > 0 && shares[msg.sender] >= s, "bad shares");
        uint256 fa = freeAssets();
        assets = s * (fa + VIRTUAL) / (totalShares + VIRTUAL);
        if (assets > fa) assets = fa; // last-exit dust guard: never pay more than free assets
        shares[msg.sender] -= s;
        totalShares -= s;
        require(fa - assets >= lockedCapacity, "would under-collateralize");
        (bool ok,) = payable(msg.sender).call{value: assets}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, assets, s);
    }

    /// @notice Current STT value of an LP's shares (for the UI / quotes).
    function previewValue(address lp) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return shares[lp] * (freeAssets() + VIRTUAL) / (totalShares + VIRTUAL);
    }

    // ---- pricing ----

    /// @notice Annualized rate (bps) for a target from its cached agent risk score.
    /// Tiers: Low (<34) 3% · Medium (34..66) 6% · High (>=67) 10%.
    function rateBps(address target) public view returns (uint256) {
        require(riskAssessed[target], "not assessed");
        return _rateForScore(riskScore[target]);
    }

    /// @notice Premium for a prospective policy. View — quotes are instant (read cache).
    function quotePremium(address target, uint256 sumInsured, uint64 duration)
        public
        view
        returns (uint256)
    {
        return sumInsured * rateBps(target) * duration / (BPS * YEAR);
    }

    /// @notice Keeper-triggered (periodic) agent risk assessment. Non-blocking: the cached
    /// score updates async when the oracle verdict lands in onVerdict. onlyOwner = keeper;
    /// it spends the oracle's deposit balance, so it is not permissionless.
    function requestRiskAssessment(address target, bytes calldata facts)
        external
        onlyOwner
        returns (bytes32 questionId)
    {
        questionId = keccak256(abi.encode("risk", target, checkNonce));
        checkNonce++;
        questionKind[questionId] = QuestionKind.Pricing;
        questionTarget[questionId] = target;
        uint256 requestId = oracle.requestRiskVerdict(questionId, facts);
        emit RiskAssessmentRequested(questionId, target, requestId);
    }

    // ---- buy ----

    function buyPolicy(address target, CoverType coverType, uint256 sumInsured, uint64 duration)
        external
        payable
        returns (uint256 id)
    {
        require(!targetSettled[target], "target settled");
        require(address(adapter[target]) != address(0), "no adapter");
        require(riskAssessed[target], "not assessed");
        require(duration > 0, "bad duration");

        uint256 pos = adapter[target].positionOf(msg.sender);
        require(sumInsured > 0, "bad cover");
        // Cap CUMULATIVE cover (across all of this buyer's policies on this target) at the
        // buyer's position — closes the multi-policy over-insurance hole.
        require(coverByBuyerTarget[msg.sender][target] + sumInsured <= pos, "over-insured");

        uint256 premium = quotePremium(target, sumInsured, duration);
        require(msg.value == premium, "bad premium");

        // Solvency: the pool must be able to back this policy on top of its existing liens.
        // (The premium just paid is already in balance → counted in freeAssets.)
        uint256 maxPayout = _maxPayout(sumInsured);
        require(freeAssets() >= lockedCapacity + maxPayout, "insufficient capacity");
        lockedCapacity += maxPayout;

        id = policies.length;
        policies.push(
            Policy({
                buyer: msg.sender,
                target: target,
                coverType: coverType,
                sumInsured: sumInsured,
                premiumPaid: premium,
                positionAtPurchase: pos,
                start: uint64(block.timestamp),
                duration: duration,
                status: PolicyStatus.Active
            })
        );
        policiesByTarget[target].push(id);
        coverByBuyerTarget[msg.sender][target] += sumInsured;
        emit PolicyBought(id, msg.sender, target, uint8(coverType), sumInsured, premium);
    }

    // ---- claim path ----

    /// @notice Nudge the Guardian to assess `target` for an exploit. Rate-limited per target.
    /// Anyone may nudge (the watcher does); the consensus + payout decision is on-chain.
    function requestCheck(address target, bytes calldata evidence) external returns (bytes32 questionId) {
        require(!targetSettled[target], "target settled");
        require(lastCheck[target] == 0 || block.timestamp >= lastCheck[target] + cooldown, "cooldown");
        lastCheck[target] = block.timestamp;

        questionId = keccak256(abi.encode("claim", target, checkNonce));
        checkNonce++;
        questionKind[questionId] = QuestionKind.Claim;
        questionTarget[questionId] = target;

        // Route the claim through the target's peril prompt (default EXPLOIT). New perils are a
        // prompt key on the oracle — no cover redeploy.
        uint256 requestId = oracle.requestVerdictFor(questionId, evidence, _perilKeyOf(target));
        emit CheckRequested(questionId, target, requestId);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "nothing to claim");
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit Claimed(msg.sender, amount);
    }

    // ---- oracle callback ----

    function onVerdict(bytes32 questionId, uint256 score, bool confirmed) external override nonReentrant {
        require(msg.sender == address(oracle), "only oracle");
        QuestionKind kind = questionKind[questionId];
        require(kind != QuestionKind.None, "unknown question");
        questionKind[questionId] = QuestionKind.None;
        address target = questionTarget[questionId];

        if (kind == QuestionKind.Pricing) {
            riskScore[target] = score;
            riskAssessedAt[target] = uint64(block.timestamp);
            riskAssessed[target] = true;
            emit RiskAssessed(target, score, _rateForScore(score));
            return;
        }

        // ---- Claim path ----
        emit VerdictReceived(questionId, target, score, confirmed);
        if (!confirmed || targetSettled[target]) {
            return;
        }
        IPositionAdapter a = adapter[target];
        require(address(a) != address(0), "no adapter");
        targetSettled[target] = true;

        uint256[] storage ids = policiesByTarget[target];
        uint256 total;
        uint256 paid;
        for (uint256 i; i < ids.length; i++) {
            Policy storage pol = policies[ids[i]];
            if (pol.status != PolicyStatus.Active) continue;
            // Either way the policy leaves Active, so release its lien on capacity.
            lockedCapacity -= _maxPayout(pol.sumInsured);
            if (block.timestamp > uint256(pol.start) + pol.duration) {
                pol.status = PolicyStatus.Expired;
                continue;
            }
            uint256 posAfter = a.positionOf(pol.buyer);
            uint256 loss = pol.positionAtPurchase > posAfter ? pol.positionAtPurchase - posAfter : 0;
            uint256 covered = loss < pol.sumInsured ? loss : pol.sumInsured;
            uint256 payout = covered * COINSURANCE_BPS / BPS;
            pol.status = PolicyStatus.Settled;
            if (payout > 0) {
                claimable[pol.buyer] += payout;
                total += payout;
                paid++;
            }
            emit PolicySettled(ids[i], pol.buyer, loss, payout);
        }
        require(address(this).balance >= totalClaimable + total, "pool insufficient");
        totalClaimable += total;
        emit Payout(target, total, paid);
    }

    function _rateForScore(uint256 s) internal pure returns (uint256) {
        if (s < 34) return 300; // Low 3%
        if (s < 67) return 600; // Medium 6%
        return 1_000; // High 10%
    }

    receive() external payable {
        emit PoolFunded(msg.sender, msg.value);
    }
}
