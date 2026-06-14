// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TrackProof Anchor — append-only, timestamped registry of capsule-batch Merkle roots (G2).
/// @notice Each root is committed with the block/timestamp that anchors it. The contract holds no
///         funds and has no owner/admin/upgrade path. Inclusion proofs are verified off-chain
///         against an anchored root; this contract is solely the trusted commitment timestamp.
contract Anchor {
    struct Record {
        uint64 blockNumber;
        uint64 timestamp;
    }

    mapping(bytes32 root => Record) private records;

    event RootAnchored(bytes32 indexed root, uint64 blockNumber, uint64 timestamp);

    error ZeroRoot();
    error RootAlreadyAnchored(bytes32 root);

    /// @notice Anchor a Merkle root. Append-only: a given root may be anchored exactly once.
    function submitRoot(bytes32 root) external {
        if (root == bytes32(0)) revert ZeroRoot();
        if (records[root].timestamp != 0) revert RootAlreadyAnchored(root);
        records[root] = Record({blockNumber: uint64(block.number), timestamp: uint64(block.timestamp)});
        emit RootAnchored(root, uint64(block.number), uint64(block.timestamp));
    }

    /// @notice Commitment record for a root; `timestamp == 0` means the root is not anchored.
    function getAnchor(bytes32 root) external view returns (uint64 blockNumber, uint64 timestamp) {
        Record memory record = records[root];
        return (record.blockNumber, record.timestamp);
    }

    function isAnchored(bytes32 root) external view returns (bool) {
        return records[root].timestamp != 0;
    }
}
