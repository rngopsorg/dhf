# hippocampus-dag — DHF Memory Lattice

Go-based IPFS-style DAG service patched with ECCA-specific structures:

- **Epoch-tagged CIDs** (multicodec `0xECCA`): `ecca://<sha256hex>@<epoch>` — the epoch suffix allows the blockstore to maintain an epoch-window index for O(log n) range scans over historical memory.
- **Blockstore index** keyed by `(epoch, stackId, cid)` with secondary indices on `kind` (`episodic` / `semantic` / `needlecast-shard`) and `pinned`.
- **Token-gated retrieval**: every `/dhf/recall` carries a `(stackId, epoch, memoryToken)` triple; recall depth is capped at the requested `memoryToken` value, and traversal halts at any node whose `epoch` lies outside the alignment window for the caller (`|caller.epoch - node.epoch| > 2` and `!pinned`).
- **DHT provider records** *(extended in the Rust alt impl, mocked here)* carry `(epoch, kind, tokenGate)` so retrieval can be denied at the routing layer.

The DAG does not store memories — it stores the substrate from which memories are *reconstructed* under epoch+token constraints.

## API

```
POST /dag/put           { stackId, epoch, ciphertext, links, kind, pinned } → { cid }
GET  /dag/get?cid=...                                                       → node
POST /pin/add?cid=...                                                       → { ok }
POST /dhf/recall        { rootCid, stackId, epoch, depth, memoryToken }     → { fragments, broken, fidelity }
GET  /stat                                                                   → { nodes, pinned, peers }
GET  /health
```
