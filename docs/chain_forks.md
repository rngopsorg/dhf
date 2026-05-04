# Chain Forks — Patches & Rationale

## medulla-pow

A from-scratch Go PoW chain inspired by btcd, with three deliberate divergences:

1. **Block header carries a coherence tuple** (`CrossRoot, EvmRoot, IpfsRoot, SleevesRoot`) — 128 bytes added to the canonical 64-byte Bitcoin-style header. The chain only mines on `submitcoherenceroot`; PoW alone cannot advance the tip.
2. **Synaptic Field MMR** rolls a 256-leaf window over recent block hashes. Anchors expose `synapticProof(blockHash) → (root, peaks, count)` for verifiers.
3. **Epoch counter** is a header field, monotone increasing, gating the cortex-evm `EpochAnchor` contract.

Difficulty re-targets every 60 blocks (≈ 240 s) toward `4 × EPOCH_INTERVAL_MS = 16 s` per block.

## hippocampus-dag

A Go reimplementation of an IPFS-style content-addressed DAG, with:

1. **Multicodec `0xECCA`** — every CID prefixed `ecca://` and suffixed `@<epoch>`. Provider records carry `(epoch, kind, tokenGate)`.
2. **Three secondary indices** (`byEpoch`, `byStack`, `byKind`) for O(log n) range scans. Pure libp2p kademlia would be O(n).
3. **Token-gated retrieval** — `/dhf/recall` enforces epoch-window + `MemoryToken` depth limit at the routing layer, not the application layer.

## cortex-evm

For v3, **upstream geth** with a custom Clique PoA genesis (chain id 131072, 4 s blocks). The patches scheduled for v3.1 are:

- **Precompiles**: `0x…1cea` `isCoherent(epoch, root)` and `0x…1ceb` `verifyMerkleShard(root, leaf, proof)` — currently mocked by `thalamus-router`.
- **Per-stack state subtrees** — each Stack NFT gets a sub-trie under `keccak256("ecca-stack", tokenId)`, allowing parallel state proofs.

See [synaptic_field_mmr.md](synaptic_field_mmr.md), [coherence_root.md](coherence_root.md).
