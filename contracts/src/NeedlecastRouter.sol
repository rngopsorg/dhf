// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NeedlecastRouter — coordinates state-transfer events across sleeves
///        and commits epoch anchors produced by the mining network.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IStackIdentity {
    function ownerOf(uint256 tokenId) external view returns (address);
    function recordNeedlecast(
        uint256 tokenId, bytes32 merkleRoot, uint256 epoch,
        bytes32 fromSleeve, bytes32 toSleeve
    ) external;
}

contract NeedlecastRouter is Ownable {
    IStackIdentity public immutable identity;

    struct EpochAnchor {
        bytes32 crossRoot;
        uint256 epoch;
        uint256 timestamp;
        address miner;
    }
    EpochAnchor[] public anchors;
    mapping(uint256 => uint256) public lastAnchorOf; // tokenId → anchor index

    event EpochAnchored(uint256 indexed epoch, bytes32 crossRoot, address indexed miner);
    event NeedlecastRouted(uint256 indexed tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve);

    constructor(address sid) Ownable(msg.sender) { identity = IStackIdentity(sid); }

    function anchorEpoch(bytes32 crossRoot, uint256 epoch) external {
        anchors.push(EpochAnchor({ crossRoot: crossRoot, epoch: epoch, timestamp: block.timestamp, miner: msg.sender }));
        emit EpochAnchored(epoch, crossRoot, msg.sender);
    }

    function route(
        uint256 tokenId,
        bytes32 merkleRoot,
        uint256 epoch,
        bytes32 fromSleeve,
        bytes32 toSleeve
    ) external {
        require(identity.ownerOf(tokenId) == msg.sender, "not stack owner");
        identity.recordNeedlecast(tokenId, merkleRoot, epoch, fromSleeve, toSleeve);
        lastAnchorOf[tokenId] = anchors.length;
        emit NeedlecastRouted(tokenId, merkleRoot, epoch, fromSleeve, toSleeve);
    }

    function anchorCount() external view returns (uint256) { return anchors.length; }
}
