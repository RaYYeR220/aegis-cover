// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ConsensusOracle} from "../src/ConsensusOracle.sol";
import {AegisCover} from "../src/AegisCover.sol";
import {MockVault} from "../src/mocks/MockVault.sol";
import {MockVaultAdapter} from "../src/mocks/MockVaultAdapter.sol";
import {IAgentRequester} from "../src/interfaces/IAgentRequester.sol";
import {IPositionAdapter} from "../src/interfaces/IPositionAdapter.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address requester = vm.envAddress("AGENT_REQUESTER");
        uint256 agentId = vm.envUint("AGENT_ID");
        uint256 oracleFund = vm.envOr("ORACLE_FUND_WEI", uint256(2 ether));
        uint256 poolFund = vm.envOr("POOL_FUND_WEI", uint256(1 ether));

        vm.startBroadcast(pk);

        ConsensusOracle oracle = new ConsensusOracle(
            IAgentRequester(requester),
            agentId,
            5, // subcommitteeSize
            3, // minResponses
            70, // scoreThreshold
            300 // timeout (s)
        );
        AegisCover cover = new AegisCover(oracle);
        MockVault vault = new MockVault();
        MockVaultAdapter adapter = new MockVaultAdapter(address(vault));

        oracle.setConsumer(address(cover), true);
        cover.setAdapter(address(vault), IPositionAdapter(address(adapter)));

        (bool ok,) = address(oracle).call{value: oracleFund}("");
        require(ok, "oracle fund");
        cover.fundPool{value: poolFund}();

        vm.stopBroadcast();

        console2.log("ConsensusOracle:", address(oracle));
        console2.log("AegisCover:", address(cover));
        console2.log("MockVault:", address(vault));
        console2.log("MockVaultAdapter:", address(adapter));
    }
}
