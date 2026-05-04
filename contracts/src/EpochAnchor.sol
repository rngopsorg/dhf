// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EpochAnchor — receives anchor commits from medulla-pow via the bridge.
///        Stores the rolling Synaptic-Field MMR root and per-epoch coherence
///        roots for fast cross-chain consistency checks.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract EpochAnchor is Ownable {
    struct Anchor {
        bytes32 crossRoot;
        bytes32 evmRoot;
        bytes32 ipfsRoot;
        bytes32 sleevesRoot;
        bytes32 synapticFieldRoot;  // MMR root from medulla-pow
        uint256 medullaHeight;
        uint256 ts;
    }
    mapping(uint256 => Anchor) public byEpoch;
    uint256 public head;

    mapping(address => bool) public bridgers;

    event EpochAnchored(uint256 indexed epoch, bytes32 crossRoot, bytes32 synapticFieldRoot, uint256 medullaHeight);
    event BridgerSet(address indexed b, bool ok);

    constructor() Ownable(msg.sender) {}

    function setBridger(address b, bool ok) external onlyOwner { bridgers[b] = ok; emit BridgerSet(b, ok); }

    function commitAnchor(
        uint256 epoch,
        bytes32 crossRoot, bytes32 evmRoot, bytes32 ipfsRoot, bytes32 sleevesRoot,
        bytes32 synapticFieldRoot, uint256 medullaHeight
    ) external {
        require(bridgers[msg.sender], "not bridger");
        require(epoch > head || head == 0, "epoch regression");
        byEpoch[epoch] = Anchor({
            crossRoot: crossRoot, evmRoot: evmRoot, ipfsRoot: ipfsRoot,
            sleevesRoot: sleevesRoot, synapticFieldRoot: synapticFieldRoot,
            medullaHeight: medullaHeight, ts: block.timestamp
        });
        head = epoch;
        emit EpochAnchored(epoch, crossRoot, synapticFieldRoot, medullaHeight);
    }
}
