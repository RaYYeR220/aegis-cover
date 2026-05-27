// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AegisCover} from "../src/AegisCover.sol";
import {IConsensusOracle} from "../src/interfaces/IConsensusOracle.sol";
import {IPositionAdapter} from "../src/interfaces/IPositionAdapter.sol";
import {MockVault} from "../src/mocks/MockVault.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";

/// Oracle stub that records the promptKey requestCheck routes through requestVerdictFor.
contract RecordingOracle is IConsensusOracle {
    bytes32 public lastPromptKey;
    bytes32 public lastQuestionId;
    uint256 public calls;
    uint256 public nextId = 1;

    function requestVerdict(bytes32, bytes calldata) external override returns (uint256) {
        return nextId++;
    }

    function requestRiskVerdict(bytes32, bytes calldata) external override returns (uint256) {
        return nextId++;
    }

    function requestVerdictFor(bytes32 questionId, bytes calldata, bytes32 promptKey)
        external
        override
        returns (uint256)
    {
        lastQuestionId = questionId;
        lastPromptKey = promptKey;
        calls++;
        return nextId++;
    }

    function setSystemPrompt(bytes32, string calldata) external override {}
}

contract AegisCoverRegistryTest is Test {
    RecordingOracle oracle;
    AegisCover cover;
    MockVault vault;
    MockVaultAdapter adapter;
    address adapterAddr;

    bytes32 constant EXPLOIT_KEY = keccak256("EXPLOIT");
    bytes32 constant DEPEG_KEY = keccak256("DEPEG");

    function setUp() public {
        oracle = new RecordingOracle();
        cover = new AegisCover(IConsensusOracle(address(oracle)));
        vault = new MockVault();
        adapter = new MockVaultAdapter(address(vault));
        adapterAddr = address(adapter);
    }

    function test_registerTarget_onlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert("only owner");
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), EXPLOIT_KEY, "DemoVault");
    }

    function test_registerTarget_setsListingAndAdapterAndList() public {
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), DEPEG_KEY, "MockStable");
        assertEq(address(cover.adapter(address(vault))), adapterAddr);
        (IPositionAdapter a, bytes32 perilKey, bool active, string memory name) = cover.listing(address(vault));
        assertEq(address(a), adapterAddr);
        assertEq(perilKey, DEPEG_KEY);
        assertTrue(active);
        assertEq(name, "MockStable");
        assertEq(cover.listedTargetsCount(), 1);
        assertEq(cover.listedTargets(0), address(vault));
    }

    function test_registerTarget_idempotentUpdatesInPlace() public {
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), EXPLOIT_KEY, "v1");
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), DEPEG_KEY, "v2");
        assertEq(cover.listedTargetsCount(), 1); // not pushed twice
        (, bytes32 perilKey,, string memory name) = cover.listing(address(vault));
        assertEq(perilKey, DEPEG_KEY);
        assertEq(name, "v2");
    }

    function test_setTargetActive_onlyOwnerAndToggles() public {
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), EXPLOIT_KEY, "x");
        vm.prank(address(0xBEEF));
        vm.expectRevert("only owner");
        cover.setTargetActive(address(vault), false);
        cover.setTargetActive(address(vault), false);
        (,, bool active,) = cover.listing(address(vault));
        assertFalse(active);
    }

    function test_requestCheck_routesDepegKeyForDepegTarget() public {
        cover.registerTarget(address(vault), IPositionAdapter(adapterAddr), DEPEG_KEY, "MockStable");
        cover.requestCheck(address(vault), hex"de");
        assertEq(oracle.lastPromptKey(), DEPEG_KEY);
        assertEq(oracle.calls(), 1);
    }

    function test_requestCheck_defaultsToExploitForUnregistered() public {
        cover.requestCheck(address(vault), hex"de"); // never registered → default peril
        assertEq(oracle.lastPromptKey(), EXPLOIT_KEY);
    }
}
