# DHF — Digital Human Freight

The **Digital Human Freight** (DHF) is the canonical encoding of a Stack's mind: the totality of episodic memory, semantic links, and the per-epoch capability schedule required to reconstruct experience under cryptographic gating.

## What the DHF actually is

A DHF is **not** a serialized blob. It is a *capability-bound walk* over the hippocampus-dag, gated by:

- The Stack's identity public key (`ecdsa-ed25519`).
- The current `epoch` (memory written at epoch `e` is only readable from epoch `e ± alignment_window` unless pinned).
- The owning sleeve's **MemoryToken** balance (depth of recall is capped at `min(requested_depth, memoryToken)`).
- The owning sleeve's **CoherenceProfileVector** coefficient (`memoryCoeff`) — a per-stack coupling constant that scales effective recall.

```
DHF(stack) := { node ∈ hippocampus | reachable from stack.episodicHead under (epoch, mt, cpv, ebc) }
```

## Encoding

Each DAG node carries:

```ts
{
  cid: ecca://<sha256>@<epoch>,
  ciphertext: AES-256-GCM(plaintext, epochKey(stackId, epoch)),
  links: [parent-cid, ...],
  epoch, kind, pinned, stackId
}
```

The `epochKey` is derived `HKDF-SHA512(masterSecret, salt=stackId, info="ecca-epoch-"+epoch)`. Loss of the master secret is unrecoverable; loss of an epoch key only blinds that epoch (a memory-keeper sleeve can still recall it via its sync rights if pinned).

## Reconstruction

`dhf-compositor` performs the reconstruction:

1. Resolve the Stack's `episodicHead` from cortex-evm (`StackIdentity.latestRoot(tokenId)`).
2. Walk the DAG breadth-first up to `depth = min(requested, memoryToken)`.
3. At each node, validate `|callerEpoch − nodeEpoch| ≤ 2 ∨ pinned`.
4. Decrypt with the per-epoch key.
5. Score `fidelity = |fragments| / (|fragments| + |broken|)`.

Fidelity below `FIDELITY_MIN_DEFAULT` triggers a `coordination.residue.detected` event of kind `historical-non-canonical` against the responsible memory-keeper.

See [memory_graph_theory.md](memory_graph_theory.md), [needlecasting_spec.md](needlecasting_spec.md).
