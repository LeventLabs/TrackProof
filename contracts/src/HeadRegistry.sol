// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TrackProof HeadRegistry — per-agent monotonic chain-head commitment (defeats tail-truncation).
/// @notice Commits each agent's latest `(seq, headLeaf)` on-chain so a verifier can reject a withheld
///         tail: a presented chain whose head seq is below the committed seq is incomplete. The first
///         committer of an `agentId` binds ownership (`msg.sender`); only that owner advances the head,
///         and `seq` must strictly increase. Holds no funds; no admin/upgrade path.
/// @dev    Like an Ed25519 agentId can't be authenticated on-chain (no EVM precompile), ownership is
///         bound to the first committer. A first-commit front-run squat is therefore possible and is
///         documented as a limitation; once bound, the head is grief-resistant.
contract HeadRegistry {
    struct Head {
        address owner;
        uint64 seq;
        uint64 blockNumber;
        uint64 timestamp;
        bytes32 headLeaf;
    }

    mapping(bytes32 agentId => Head) private heads;

    event HeadCommitted(bytes32 indexed agentId, address indexed owner, uint64 seq, bytes32 headLeaf);

    error NotHeadOwner(bytes32 agentId);
    error SeqNotIncreasing(uint64 committed, uint64 submitted);

    /// @notice Commit or advance an agent's chain head. First commit binds ownership to `msg.sender`;
    ///         later commits require the same sender and a strictly greater `seq`.
    function commitHead(bytes32 agentId, uint64 seq, bytes32 headLeaf) external {
        Head storage h = heads[agentId];
        if (h.owner == address(0)) {
            h.owner = msg.sender;
        } else {
            if (h.owner != msg.sender) revert NotHeadOwner(agentId);
            if (seq <= h.seq) revert SeqNotIncreasing(h.seq, seq);
        }
        h.seq = seq;
        h.headLeaf = headLeaf;
        h.blockNumber = uint64(block.number);
        h.timestamp = uint64(block.timestamp);
        emit HeadCommitted(agentId, msg.sender, seq, headLeaf);
    }

    /// @notice The committed head for an agent; `owner == address(0)` means none committed.
    function getHead(bytes32 agentId)
        external
        view
        returns (address owner, uint64 seq, bytes32 headLeaf, uint64 blockNumber, uint64 timestamp)
    {
        Head memory h = heads[agentId];
        return (h.owner, h.seq, h.headLeaf, h.blockNumber, h.timestamp);
    }
}
