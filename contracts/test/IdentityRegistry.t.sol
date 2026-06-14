// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IdentityRegistry} from "../src/IdentityRegistry.sol";

contract IdentityRegistryTest {
    IdentityRegistry internal registry;
    bytes32 internal constant AGENT = bytes32(uint256(0xABCD));

    function setUp() public {
        registry = new IdentityRegistry();
    }

    function test_EnrollStoresGenesis() public {
        registry.enroll(AGENT, "ipfs://agent-1");
        (string memory uri, uint64 genesisBlock, uint64 genesisTimestamp) = registry.getAgent(AGENT);
        require(keccak256(bytes(uri)) == keccak256(bytes("ipfs://agent-1")), "uri mismatch");
        require(genesisTimestamp == uint64(block.timestamp), "genesis timestamp");
        require(genesisBlock == uint64(block.number), "genesis block");
        require(registry.isEnrolled(AGENT), "should be enrolled");
    }

    function test_DoubleEnrollReverts() public {
        registry.enroll(AGENT, "ipfs://agent-1");
        (bool ok,) =
            address(registry).call(abi.encodeWithSelector(IdentityRegistry.enroll.selector, AGENT, "ipfs://other"));
        require(!ok, "re-enrolling an agent must revert");
    }

    function test_UnknownAgentIsEmpty() public view {
        require(!registry.isEnrolled(bytes32(uint256(0x1234))), "unknown agent should not be enrolled");
    }
}
