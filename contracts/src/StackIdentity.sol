// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StackIdentity — ERC-721 anchor for a DHF Stack.
/// @notice Each tokenId represents a persistent cognitive identity. Memory,
///         sleeves, and cognitive state live off-chain (DAG + sleeves +
///         coordination engine). On-chain we record only:
///           - the identity public key,
///           - the latest cross-chain coherence root,
///           - epoch counter,
///           - Coherence Profile Vector (CPV) and Epoch Binding Curve (EBC).
///
///         The CPV defines per-stack token interaction coefficients; the EBC
///         decays token effects over time. See docs/token_economy.md.

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract StackIdentity is ERC721, Ownable {
    uint256 public nextTokenId = 1;

    struct CoherenceProfile {
        // Coefficients scaled by 1e6 (i.e. 1.0 == 1_000_000).
        uint256 computeCoeff;
        uint256 memoryCoeff;
        uint256 syncCoeff;
        uint256 routingCoeff;
        uint256 residueCoeff;
    }

    struct EpochBinding {
        uint256 decayRateX1e6; // 0..1e6
        uint256 floorX1e6;     // 0..1e6
    }

    struct Stack {
        bytes pubkey;            // ed25519 SPKI/raw 32-byte
        bytes32 latestRoot;      // most recent cross-chain coherence root
        uint256 epoch;           // monotonic epoch counter
        CoherenceProfile cpv;
        EpochBinding binding;
        uint256 createdAt;
    }

    mapping(uint256 => Stack) private _stacks;
    mapping(address => bool) public authorizedRouters; // contracts allowed to update needlecast state

    event StackMinted(uint256 indexed tokenId, address indexed owner, bytes pubkey);
    event Needlecast(uint256 indexed tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve);
    event CoherenceUpdated(uint256 indexed tokenId, bytes32 root, uint256 epoch);
    event RouterAuthorized(address indexed router, bool ok);

    constructor() ERC721("ECCA StackIdentity", "STACK") Ownable(msg.sender) {}

    function setRouter(address router, bool ok) external onlyOwner {
        authorizedRouters[router] = ok;
        emit RouterAuthorized(router, ok);
    }

    function mintStack(
        bytes calldata pubkey,
        uint256[5] calldata cpvX1e6,
        uint256 decayRateX1e6,
        uint256 floorX1e6
    ) external returns (uint256 id) {
        require(decayRateX1e6 <= 1_000_000 && floorX1e6 <= 1_000_000, "binding out of range");
        for (uint256 i = 0; i < 5; ++i) require(cpvX1e6[i] <= 2_000_000, "cpv coeff > 2.0");

        id = nextTokenId++;
        _safeMint(msg.sender, id);
        _stacks[id] = Stack({
            pubkey: pubkey,
            latestRoot: bytes32(0),
            epoch: 0,
            cpv: CoherenceProfile(cpvX1e6[0], cpvX1e6[1], cpvX1e6[2], cpvX1e6[3], cpvX1e6[4]),
            binding: EpochBinding(decayRateX1e6, floorX1e6),
            createdAt: block.timestamp
        });
        emit StackMinted(id, msg.sender, pubkey);
    }

    function recordNeedlecast(
        uint256 tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        bytes32 fromSleeve,
        bytes32 toSleeve
    ) external {
        require(authorizedRouters[msg.sender], "not router");
        Stack storage s = _stacks[tokenId];
        require(s.createdAt != 0, "no stack");
        require(epoch >= s.epoch, "epoch regression");
        s.latestRoot = merkleRoot;
        s.epoch = epoch;
        emit Needlecast(tokenId, merkleRoot, epoch, fromSleeve, toSleeve);
        emit CoherenceUpdated(tokenId, merkleRoot, epoch);
    }

    // ─── Read accessors ────────────────────────────────────────────────────
    function pubkey(uint256 tokenId) external view returns (bytes memory) { return _stacks[tokenId].pubkey; }
    function stackEpoch(uint256 tokenId) external view returns (uint256) { return _stacks[tokenId].epoch; }
    function latestRoot(uint256 tokenId) external view returns (bytes32) { return _stacks[tokenId].latestRoot; }
    function cpv(uint256 tokenId) external view returns (CoherenceProfile memory) { return _stacks[tokenId].cpv; }
    function binding(uint256 tokenId) external view returns (EpochBinding memory) { return _stacks[tokenId].binding; }
}
