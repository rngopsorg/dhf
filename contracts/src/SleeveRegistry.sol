// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SleeveRegistry — registers active sleeves for a stack with their
///        embodiment type and per-sleeve token allocation slice.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IStackIdentity {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract SleeveRegistry is Ownable {
    enum Embodiment { Human, Ai, Mining, Memory }

    struct SleeveRec {
        uint256 tokenId;       // bound stack
        Embodiment kind;
        bool alive;
        uint256 createdAt;
        bytes32 hostId;        // optional hostname/container id
    }

    mapping(bytes32 => SleeveRec) public sleeves;
    mapping(uint256 => bytes32[]) public sleevesOfStack;

    IStackIdentity public stackIdentity;

    event SleeveRegistered(bytes32 indexed sleeveId, uint256 indexed tokenId, uint8 kind, bytes32 hostId);
    event SleeveDecommissioned(bytes32 indexed sleeveId, uint256 indexed tokenId);

    constructor(address sid) Ownable(msg.sender) { stackIdentity = IStackIdentity(sid); }

    function register(bytes32 sleeveId, uint256 tokenId, uint8 kind, bytes32 hostId) external {
        require(stackIdentity.ownerOf(tokenId) == msg.sender, "not stack owner");
        require(sleeves[sleeveId].createdAt == 0, "already registered");
        sleeves[sleeveId] = SleeveRec({
            tokenId: tokenId, kind: Embodiment(kind), alive: true,
            createdAt: block.timestamp, hostId: hostId
        });
        sleevesOfStack[tokenId].push(sleeveId);
        emit SleeveRegistered(sleeveId, tokenId, kind, hostId);
    }

    function decommission(bytes32 sleeveId) external {
        SleeveRec storage s = sleeves[sleeveId];
        require(s.alive, "not alive");
        require(stackIdentity.ownerOf(s.tokenId) == msg.sender, "not stack owner");
        s.alive = false;
        emit SleeveDecommissioned(sleeveId, s.tokenId);
    }

    function listOf(uint256 tokenId) external view returns (bytes32[] memory) { return sleevesOfStack[tokenId]; }
}
