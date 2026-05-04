// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BandwidthToken — abstract base for the four (or five) cognitive
///        bandwidth tokens. Balances are keyed by `tokenId` (the StackIdentity
///        NFT) rather than by EOA — bandwidth follows identity, not wallet.
///
///        Concrete subclasses: ComputeToken, MemoryToken, SyncToken,
///        RoutingToken, ResidueToken. See docs/token_economy.md.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

abstract contract BandwidthToken is Ownable {
    string public name;
    string public symbol;
    uint8  public constant decimals = 18;
    uint256 public totalSupply;

    /// @notice Per-stack balance (NOT per-wallet). Bandwidth is an identity property.
    mapping(uint256 => uint256) public balanceOfStack;

    /// @notice Approved spenders per stack — typically sleeve runtimes / treasury.
    mapping(uint256 => mapping(address => bool)) public sleeveAuthorized;

    address public minter;
    address public stackIdentity; // address of StackIdentity contract for ownership checks

    event Transfer(uint256 indexed fromStack, uint256 indexed toStack, uint256 amount);
    event Mint(uint256 indexed tokenId, uint256 amount, bytes32 reason);
    event BandwidthSpent(uint256 indexed tokenId, address indexed sleeve, uint256 amount, bytes32 reason);
    event SleeveAuthorized(uint256 indexed tokenId, address indexed sleeve, bool ok);
    event MinterChanged(address indexed minter);

    constructor(string memory _name, string memory _symbol, address _stackIdentity) Ownable(msg.sender) {
        name = _name;
        symbol = _symbol;
        minter = msg.sender;
        stackIdentity = _stackIdentity;
    }

    modifier onlyStackOwner(uint256 tokenId) {
        require(_isStackOwner(tokenId, msg.sender), "not stack owner");
        _;
    }

    function _isStackOwner(uint256 tokenId, address who) internal view returns (bool) {
        (bool ok, bytes memory data) = stackIdentity.staticcall(abi.encodeWithSignature("ownerOf(uint256)", tokenId));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (address)) == who;
    }

    function setMinter(address m) external onlyOwner { minter = m; emit MinterChanged(m); }

    function authorizeSleeve(uint256 tokenId, address sleeve, bool ok) external onlyStackOwner(tokenId) {
        sleeveAuthorized[tokenId][sleeve] = ok;
        emit SleeveAuthorized(tokenId, sleeve, ok);
    }

    function mint(uint256 tokenId, uint256 amount, bytes32 reason) external {
        require(msg.sender == minter, "not minter");
        balanceOfStack[tokenId] += amount;
        totalSupply += amount;
        emit Mint(tokenId, amount, reason);
    }

    /// @notice Spend (burn) bandwidth on a labeled cognitive operation.
    function spend(uint256 tokenId, uint256 amount, bytes32 reason) external {
        require(
            sleeveAuthorized[tokenId][msg.sender] || _isStackOwner(tokenId, msg.sender),
            "not authorized to spend"
        );
        require(balanceOfStack[tokenId] >= amount, "insufficient bandwidth");
        balanceOfStack[tokenId] -= amount;
        totalSupply -= amount;
        emit BandwidthSpent(tokenId, msg.sender, amount, reason);
    }

    /// @notice Stack-to-stack transfer (e.g. for treasury operations).
    function transferStack(uint256 fromTokenId, uint256 toTokenId, uint256 amount) external onlyStackOwner(fromTokenId) {
        require(balanceOfStack[fromTokenId] >= amount, "insufficient");
        balanceOfStack[fromTokenId] -= amount;
        balanceOfStack[toTokenId]   += amount;
        emit Transfer(fromTokenId, toTokenId, amount);
    }
}

/// Five concrete tokens — only the constructor differs. Symbols match
/// `packages/proto/src/tokens.ts`.
contract ComputeToken is BandwidthToken {
    constructor(address sid) BandwidthToken("ECCA ComputeToken", "CMP", sid) {}
}
contract MemoryToken  is BandwidthToken {
    constructor(address sid) BandwidthToken("ECCA MemoryToken",  "MEM", sid) {}
}
contract SyncToken    is BandwidthToken {
    constructor(address sid) BandwidthToken("ECCA SyncToken",    "SYN", sid) {}
}
contract RoutingToken is BandwidthToken {
    constructor(address sid) BandwidthToken("ECCA RoutingToken", "RTE", sid) {}
}
contract ResidueToken is BandwidthToken {
    constructor(address sid) BandwidthToken("ECCA ResidueToken", "RES", sid) {}
}
