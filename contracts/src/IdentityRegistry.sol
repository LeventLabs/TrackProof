// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TrackProof Identity Registry (ERC-8004-compatible)
/// @notice Binds an agentId (the agent's Ed25519 public key) to an identity URI and an immutable
///         enrollment genesis (block/timestamp) — the anchor for "complete history since
///         enrollment" and the reputation age metric. "ERC-8004-compatible" in shape; full
///         ERC-8004 conformance is deferred pending a usability check (project decision). The
///         contract holds no funds and has no owner/admin/upgrade path. Append-only.
contract IdentityRegistry {
    struct Agent {
        string identityURI;
        uint64 genesisBlock;
        uint64 genesisTimestamp;
    }

    mapping(bytes32 agentId => Agent) private agents;

    event AgentEnrolled(bytes32 indexed agentId, string identityURI, uint64 genesisBlock, uint64 genesisTimestamp);

    error AlreadyEnrolled(bytes32 agentId);

    /// @notice Enroll an agent. Append-only: an agentId enrolls once; its genesis is immutable.
    function enroll(bytes32 agentId, string calldata identityURI) external {
        if (agents[agentId].genesisTimestamp != 0) revert AlreadyEnrolled(agentId);
        agents[agentId] = Agent({
            identityURI: identityURI,
            genesisBlock: uint64(block.number),
            genesisTimestamp: uint64(block.timestamp)
        });
        emit AgentEnrolled(agentId, identityURI, uint64(block.number), uint64(block.timestamp));
    }

    function getAgent(bytes32 agentId)
        external
        view
        returns (string memory identityURI, uint64 genesisBlock, uint64 genesisTimestamp)
    {
        Agent memory agent = agents[agentId];
        return (agent.identityURI, agent.genesisBlock, agent.genesisTimestamp);
    }

    function isEnrolled(bytes32 agentId) external view returns (bool) {
        return agents[agentId].genesisTimestamp != 0;
    }
}
