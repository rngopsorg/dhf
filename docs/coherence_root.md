# Coherence Root

The **Coherence Root** is a 32-byte hash committed once per epoch into medulla-pow's block header. It binds the four shard roots into a single point of truth.

## Construction

```
crossRoot = sha256( "ecca-coh-v1" ‖ evmRoot ‖ btcRoot ‖ ipfsRoot ‖ sleevesRoot )
```

where each shard root is a per-epoch Merkle root over the shard's events:

- **evmRoot**: `merkleRoot([txHash for tx in epoch where contract ∈ ECCA_CONTRACTS])`
- **btcRoot**: reserved (unused in v3; kept for cross-network bridge in v3.1) → 32 zero bytes
- **ipfsRoot**: `merkleRoot([sha256(cid) for write in epoch])`
- **sleevesRoot**: `merkleRoot([sha256(type ‖ id) for sleeve event in epoch])`

## Verification

A verifier with the medulla anchor `(blockHash, epoch, crossRoot, evmRoot, ipfsRoot, sleevesRoot)` can prove:

- a specific cortex-evm tx was included in epoch `e` via Merkle proof against `evmRoot`
- a specific hippocampus write was anchored via Merkle proof against `ipfsRoot`
- a specific sleeve event existed via proof against `sleevesRoot`

All three proofs share the same root commitment. **One PoW finality finalizes three shards simultaneously.**

## Anti-Equivocation

The thalamus-router signs each `submitcoherenceroot` RPC with its operator key. Two distinct tuples for the same epoch from the same operator → automatic `routing-equivocation` residue with full operator slash via `QuellistTreasury`.

See [synaptic_field_mmr.md](synaptic_field_mmr.md), [coordination_residues.md](coordination_residues.md).
