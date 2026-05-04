# Synaptic Field MMR

The **Synaptic Field** is an append-only [Merkle Mountain Range](https://github.com/opentimestamps/opentimestamps-server/blob/master/doc/merkle-mountain-range.md) over medulla-pow block hashes. It is maintained inside the chain (not as an external service) so anchors are atomic with PoW finality.

## Structure

```
height 3:           ●
                  /   \
height 2:        ●     ●
                / \   / \
height 1:      ●   ● ●   ●
              /\  /\ /\  /\
height 0:    ● ●● ●● ●● ●● …    ← block hashes appended here
```

Append rules:

- Each new leaf increments `count`.
- After append, walk up: while the new node's height matches its sibling's, hash them together (`hashNode = sha256(0x01 ‖ left ‖ right)`); else stop.
- The MMR's root at any time is the **bagged peaks**, hashed right-to-left.

## Rolling Window

ECCA bounds the MMR at `SYNAPTIC_FIELD_DEPTH = 256` leaves. When the window is full, the oldest peak is dropped on the next append. This caps verification cost at $O(\log_2 256) = 8$ hash ops per inclusion proof, regardless of chain age.

## Why an MMR (not a balanced tree)

- **Append-only**: never rebuilds, never re-hashes.
- **Stable peaks**: an old proof remains valid as long as the peaks it references remain in the window.
- **Cheap incremental commitment**: the per-block cost is $O(\log n)$, with $n$ = current depth.

## Verification

A `synapticProof(blockHash) = (root, peaks, count, indexInLeaves)` enables a verifier to confirm that a given block was anchored at a specific position in the field, without needing the full chain.

See [chain_forks.md](chain_forks.md), [coherence_root.md](coherence_root.md).
