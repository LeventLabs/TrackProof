// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Anchor} from "../src/Anchor.sol";

/// Minimal tests (no forge-std dependency): `require` asserts; low-level calls catch reverts.
contract AnchorTest {
    Anchor internal anchor;
    bytes32 internal constant ROOT = keccak256("root-1");

    function setUp() public {
        anchor = new Anchor();
    }

    function test_SubmitStoresRecord() public {
        anchor.submitRoot(ROOT);
        (uint64 blockNumber, uint64 timestamp) = anchor.getAnchor(ROOT);
        require(timestamp == uint64(block.timestamp), "timestamp mismatch");
        require(blockNumber == uint64(block.number), "block mismatch");
        require(anchor.isAnchored(ROOT), "should be anchored");
    }

    function test_UnanchoredRootIsEmpty() public view {
        (uint64 blockNumber, uint64 timestamp) = anchor.getAnchor(keccak256("absent"));
        require(blockNumber == 0 && timestamp == 0, "absent root should be empty");
        require(!anchor.isAnchored(keccak256("absent")), "absent root not anchored");
    }

    function test_ReanchorReverts() public {
        anchor.submitRoot(ROOT);
        (bool ok,) = address(anchor).call(abi.encodeWithSelector(Anchor.submitRoot.selector, ROOT));
        require(!ok, "re-anchoring the same root must revert");
    }

    function test_ZeroRootReverts() public {
        (bool ok,) = address(anchor).call(abi.encodeWithSelector(Anchor.submitRoot.selector, bytes32(0)));
        require(!ok, "anchoring the zero root must revert");
    }
}
