// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPrompt} from "../src/AgentPrompt.sol";

contract AgentPromptTest is Test {
    function test_systemPromptMentionsExploitAndScale() public pure {
        string memory s = AgentPrompt.SYSTEM();
        assertGt(bytes(s).length, 0);
        // sanity: contains the scoring scale hint
        assertTrue(_contains(s, "0-100"));
    }

    function test_buildPromptEmbedsEvidence() public pure {
        bytes memory evidence = bytes('{"schema":"aegis-exploit-evidence/1","target":"0xabc"}');
        string memory p = AgentPrompt.buildPrompt(evidence);
        assertTrue(_contains(p, "aegis-exploit-evidence/1"));
    }

    function test_riskSystemPromptMentionsScaleAndRisk() public pure {
        string memory s = AgentPrompt.RISK_SYSTEM();
        assertGt(bytes(s).length, 0);
        assertTrue(_contains(s, "0-100"));
        assertTrue(_contains(s, "risk"));
    }

    function test_buildRiskPromptEmbedsFacts() public pure {
        bytes memory facts = bytes('{"protocol":"MockVault","audit":"none"}');
        string memory p = AgentPrompt.buildRiskPrompt(facts);
        assertTrue(_contains(p, "MockVault"));
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return n.length == 0;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }
}
