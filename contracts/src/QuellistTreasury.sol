// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuellistTreasury — issues bandwidth tokens against epoch progress and
///        residue resolution proofs. Named for Quellcrist Falconer.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IBandwidthMintable {
    function mint(uint256 tokenId, uint256 amount, bytes32 reason) external;
}

contract QuellistTreasury is Ownable {
    address public compute;
    address public memoryT;
    address public syncT;
    address public routing;
    address public residueT;

    mapping(uint256 => uint256) public lastClaimEpoch;
    mapping(uint256 => uint256) public claimable;

    uint256 public emissionPerEpoch = 100 ether; // bandwidth units per epoch per stack

    event RewardIssued(uint256 indexed tokenId, uint8 indexed kind, uint256 amount, bytes32 reason);
    event EmissionChanged(uint256 newEmission);

    constructor(address _c, address _m, address _s, address _r, address _res) Ownable(msg.sender) {
        compute = _c; memoryT = _m; syncT = _s; routing = _r; residueT = _res;
    }

    function setEmission(uint256 e) external onlyOwner { emissionPerEpoch = e; emit EmissionChanged(e); }

    /// @notice Issue tokens of `kind` to a stack. Used by the bandwidth-faucet
    ///         and by ResidueRegistry payouts.
    /// kind: 0=compute, 1=memory, 2=sync, 3=routing, 4=residue
    function issue(uint256 tokenId, uint8 kind, uint256 amount, bytes32 reason) external onlyOwner {
        address t = _tokenOf(kind);
        IBandwidthMintable(t).mint(tokenId, amount, reason);
        emit RewardIssued(tokenId, kind, amount, reason);
    }

    /// @notice Claim epoch-progress emissions for a stack. Equal across the four
    ///         core bandwidth tokens (residue is reserved for repair work).
    function claimEpochRewards(uint256 tokenId, uint256 currentEpoch) external onlyOwner {
        uint256 last = lastClaimEpoch[tokenId];
        require(currentEpoch > last, "no new epochs");
        uint256 elapsed = currentEpoch - last;
        uint256 amount = emissionPerEpoch * elapsed;
        IBandwidthMintable(compute).mint(tokenId, amount, "epoch.compute");
        IBandwidthMintable(memoryT).mint(tokenId, amount, "epoch.memory");
        IBandwidthMintable(syncT  ).mint(tokenId, amount, "epoch.sync");
        IBandwidthMintable(routing).mint(tokenId, amount, "epoch.routing");
        lastClaimEpoch[tokenId] = currentEpoch;
        emit RewardIssued(tokenId, 0, amount, "epoch.compute");
        emit RewardIssued(tokenId, 1, amount, "epoch.memory");
        emit RewardIssued(tokenId, 2, amount, "epoch.sync");
        emit RewardIssued(tokenId, 3, amount, "epoch.routing");
    }

    function _tokenOf(uint8 kind) internal view returns (address) {
        if (kind == 0) return compute;
        if (kind == 1) return memoryT;
        if (kind == 2) return syncT;
        if (kind == 3) return routing;
        if (kind == 4) return residueT;
        revert("bad kind");
    }
}
