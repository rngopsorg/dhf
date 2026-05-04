# Cross-Chain Synchronization

ECCA's three primary chains (`medulla-pow`, `hippocampus-dag`, `cortex-evm`) are **independent ledgers**. Synchronization is achieved at the *epoch boundary*, not at every transaction.

## Phases

```
[ within-epoch ]            [ at epoch boundary ]
  cortex-evm: txs            thalamus: collect roots
  hippocampus: writes        medulla: mine block over (cross,evm,ipfs,sleeves)
  sleeves: percepts          MMR: append block hash → SynapticFieldRoot
                             EpochAnchor.commitAnchor(crossRoot, evmRoot, ipfsRoot, sleevesRoot, mmrRoot, height)
```

## Causality Guarantees

Within a single chain, normal causality holds (cortex is linearly ordered; hippocampus is partially ordered by epoch; medulla is linearly ordered by height).

Across chains, **causality is asserted only between events that share an epoch**. Two events in the same epoch are causally comparable iff they share a path through the cross-shard merkle tree. Events in different epochs are ordered by `(epoch, intra-epoch-order)`.

## Reorgs

A medulla-pow reorg invalidates all epochs at heights ≥ the fork point. The thalamus-router replays buffered events into the new canonical chain; cortex-evm and hippocampus do **not** roll back — instead, the discrepancy materializes as `reorg-orphan` residues that resolvers earn bounties to repair.

This is the *Altered Carbon "stack survives the body"* invariant lifted to the protocol level: the **memory of the system survives partial chain death**.

See [coherence_root.md](coherence_root.md), [synaptic_field_mmr.md](synaptic_field_mmr.md).
