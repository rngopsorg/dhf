// Cortex EVM client — viem wrapper for the patched-geth Synaptic Stack.

import { createPublicClient, createWalletClient, http, defineChain, type PublicClient, type WalletClient, type Hex, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const cortexChain = defineChain({
  id: Number(process.env.CORTEX_CHAIN_ID ?? 131072),
  name: 'Cortex EVM',
  nativeCurrency: { name: 'Siyana', symbol: 'SYN', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CORTEX_RPC ?? 'http://cortex-evm:8545'] },
  },
});

export function cortexPublic(): PublicClient {
  return createPublicClient({ chain: cortexChain, transport: http() });
}

export function cortexWallet(privateKey: Hex): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({ account, chain: cortexChain, transport: http() });
}

// Canonical ABIs — kept inline (small) so consumers don't need artifact imports.
export const STACK_IDENTITY_ABI = parseAbi([
  'event StackMinted(uint256 indexed tokenId, address indexed owner, bytes pubkey)',
  'event Needlecast(uint256 indexed tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve)',
  'event CoherenceUpdated(uint256 indexed tokenId, bytes32 root, uint256 epoch)',
  'function nextTokenId() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function mintStack(bytes calldata pubkey, uint256[5] calldata cpvX1e6, uint256 decayRateX1e6, uint256 floorX1e6) external returns (uint256)',
  'function recordNeedlecast(uint256 tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve) external',
  'function stackEpoch(uint256 tokenId) view returns (uint256)',
  'function latestRoot(uint256 tokenId) view returns (bytes32)',
]);

export const BANDWIDTH_TOKEN_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event BandwidthSpent(uint256 indexed tokenId, address indexed sleeve, uint256 amount, bytes32 reason)',
  'function balanceOfStack(uint256 tokenId) view returns (uint256)',
  'function mint(uint256 tokenId, uint256 amount) external',
  'function spend(uint256 tokenId, uint256 amount, bytes32 reason) external',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]);

export const RESIDUE_REGISTRY_ABI = parseAbi([
  'event ResidueDetected(bytes32 indexed residueId, uint8 kind, uint256 stackId, uint256 bountyEst)',
  'event ResidueResolved(bytes32 indexed residueId, uint256 indexed resolverTokenId, uint256 payout)',
  'function detect(bytes32 residueId, uint8 kind, uint256 stackId, uint256 bountyEst) external',
  'function submitProof(bytes32 residueId, uint256 resolverTokenId, bytes calldata proof) external',
  'function residue(bytes32 id) view returns (uint8 kind, uint256 stackId, uint256 bountyEst, uint8 status, uint256 resolverTokenId, uint256 payout)',
]);

export const NEEDLECAST_ROUTER_ABI = parseAbi([
  'event EpochAnchored(uint256 indexed epoch, bytes32 crossRoot, address indexed miner)',
  'event NeedlecastRouted(uint256 indexed tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve)',
  'function anchorEpoch(bytes32 crossRoot, uint256 epoch) external',
  'function route(uint256 tokenId, bytes32 merkleRoot, uint256 epoch, bytes32 fromSleeve, bytes32 toSleeve) external',
]);

export const QUELLIST_TREASURY_ABI = parseAbi([
  'event RewardIssued(uint256 indexed tokenId, uint8 indexed kind, uint256 amount, bytes32 reason)',
  'function issue(uint256 tokenId, uint8 kind, uint256 amount, bytes32 reason) external',
  'function claim(uint256 tokenId) external',
]);
