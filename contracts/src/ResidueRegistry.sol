// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ResidueRegistry — accepts proofs of MEV-like coordination residue
///        resolution and pays out from QuellistTreasury in ResidueToken.
///
///        Per theory.md §8, MEV is reframed: residues are not extracted, they
///        are *resolved into canonical state*. The first valid resolution
///        proof receives the bounty (configurable: 'first-valid-proof' or
///        'auction').

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IBandwidthToken {
    function mint(uint256 tokenId, uint256 amount, bytes32 reason) external;
}

interface IStackIdentity {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract ResidueRegistry is Ownable {
    enum Kind {
        StaleOrdering,             // high routing + low sync
        SpeculativeDivergence,     // high compute + low memory
        HistoricalNonCanonical,    // high memory + low sync
        ReorgOrphan,               // medulla-pow reorg crossed an anchor
        ShardLoss                  // pinned shard evicted
    }
    enum Status { Open, Claimed, Resolved }

    struct Residue {
        Kind kind;
        uint256 stackId;       // 0 if global
        uint256 bountyEst;
        Status status;
        uint256 resolverTokenId;
        uint256 payout;
        bytes32 proofHash;
        uint256 detectedAt;
        uint256 resolvedAt;
    }

    mapping(bytes32 => Residue) public residue;
    bytes32[] public residueIds;

    IBandwidthToken public residueToken;
    IStackIdentity  public stackIdentity;

    string public payoutModel = "first-valid-proof"; // or "auction"
    uint256 public constant MAX_BOUNTY = 1e24;

    event ResidueDetected(bytes32 indexed residueId, uint8 kind, uint256 stackId, uint256 bountyEst);
    event ResidueResolved(bytes32 indexed residueId, uint256 indexed resolverTokenId, uint256 payout);
    event PayoutModelChanged(string model);

    constructor(address rt, address sid) Ownable(msg.sender) {
        residueToken = IBandwidthToken(rt);
        stackIdentity = IStackIdentity(sid);
    }

    function setPayoutModel(string calldata m) external onlyOwner {
        payoutModel = m;
        emit PayoutModelChanged(m);
    }

    function detect(bytes32 residueId, uint8 kind, uint256 stackId, uint256 bountyEst) external {
        require(residue[residueId].detectedAt == 0, "already detected");
        require(bountyEst <= MAX_BOUNTY, "bounty too large");
        residue[residueId] = Residue({
            kind: Kind(kind),
            stackId: stackId,
            bountyEst: bountyEst,
            status: Status.Open,
            resolverTokenId: 0,
            payout: 0,
            proofHash: bytes32(0),
            detectedAt: block.timestamp,
            resolvedAt: 0
        });
        residueIds.push(residueId);
        emit ResidueDetected(residueId, kind, stackId, bountyEst);
    }

    /// @notice Submit a resolution proof. The bytes payload is opaque on-chain;
    ///         off-chain workers (residue-collector) verify it before submission.
    function submitProof(bytes32 residueId, uint256 resolverTokenId, bytes calldata proof) external {
        Residue storage r = residue[residueId];
        require(r.detectedAt != 0, "no residue");
        require(r.status == Status.Open, "already resolved");
        require(stackIdentity.ownerOf(resolverTokenId) == msg.sender, "not resolver owner");

        bytes32 ph = keccak256(proof);
        r.status = Status.Resolved;
        r.resolverTokenId = resolverTokenId;
        r.payout = r.bountyEst;
        r.proofHash = ph;
        r.resolvedAt = block.timestamp;

        residueToken.mint(resolverTokenId, r.bountyEst, residueId);
        emit ResidueResolved(residueId, resolverTokenId, r.bountyEst);
    }

    function residueCount() external view returns (uint256) { return residueIds.length; }
}
