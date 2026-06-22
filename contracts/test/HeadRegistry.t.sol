// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HeadRegistry} from "../src/HeadRegistry.sol";

/// Calls `commitHead` from its own address, so tests can exercise the msg.sender ownership binding.
contract HeadCaller {
    HeadRegistry internal reg;

    constructor(HeadRegistry r) {
        reg = r;
    }

    function commit(bytes32 agentId, uint64 seq, bytes32 leaf) external {
        reg.commitHead(agentId, seq, leaf);
    }
}

/// Minimal tests (no forge-std): `require` asserts; low-level calls catch reverts.
contract HeadRegistryTest {
    HeadRegistry internal reg;
    bytes32 internal constant AGENT = keccak256("agent-1");
    bytes32 internal constant LEAF = keccak256("leaf-head");

    function setUp() public {
        reg = new HeadRegistry();
    }

    function test_FirstCommitBindsOwnerAndStores() public {
        reg.commitHead(AGENT, 5, LEAF);
        (address owner, uint64 seq, bytes32 headLeaf,, uint64 timestamp) = reg.getHead(AGENT);
        require(owner == address(this), "owner should be the first committer");
        require(seq == 5, "seq mismatch");
        require(headLeaf == LEAF, "leaf mismatch");
        require(timestamp == uint64(block.timestamp), "timestamp mismatch");
    }

    function test_AdvanceRequiresStrictlyHigherSeq() public {
        reg.commitHead(AGENT, 5, LEAF);
        reg.commitHead(AGENT, 10, keccak256("leaf-10")); // ok: higher
        (, uint64 seq,,,) = reg.getHead(AGENT);
        require(seq == 10, "should advance to 10");
        (bool lower,) = address(reg).call(abi.encodeWithSelector(HeadRegistry.commitHead.selector, AGENT, 8, LEAF));
        require(!lower, "a lower seq must revert");
        (bool equal,) = address(reg).call(abi.encodeWithSelector(HeadRegistry.commitHead.selector, AGENT, 10, LEAF));
        require(!equal, "an equal seq must revert");
    }

    function test_NonOwnerCannotAdvance() public {
        reg.commitHead(AGENT, 1, LEAF); // this contract owns AGENT
        HeadCaller other = new HeadCaller(reg);
        (bool ok,) = address(other).call(abi.encodeWithSelector(HeadCaller.commit.selector, AGENT, 2, LEAF));
        require(!ok, "a non-owner must not advance the head");
    }

    function test_AbsentHeadIsEmpty() public view {
        (address owner, uint64 seq,,,) = reg.getHead(keccak256("absent"));
        require(owner == address(0) && seq == 0, "absent head should be empty");
    }
}
