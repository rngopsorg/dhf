# Needlecasting Specification

**Needlecasting** is the atomic transfer of a sleeve's executive control over a Stack from one host to another. It is implemented as a six-step saga in `needlecast-router-svc` with full rollback on any step failure.

## Saga

| Step | Operation | Rollback |
|---|---|---|
| 1 | `freeze(source)` — `sleeve.alive = false` | unfreeze |
| 2 | `shard(episodicHead, depth=8)` — collect CIDs from DAG walk | none (read-only) |
| 3 | `pin(shards)` — durability bond, hippocampus pin set | unpin (deferred) |
| 4 | `anchor(saga)` — emit `needlecast.route` event for thalamus to fold into next epoch | drop pending fold |
| 5 | `reconstruct(target)` — `target.drift = 0`, sync to source.epoch | restore target state |
| 6 | `settle(source)` — debit `RoutingToken` from source by `cost = 5` | re-credit |

## Cost Model

```
needlecast_cost = base_cost + α × shard_count + β × |sourceEpoch − targetEpoch|
                = 5      + 0.1 × n        + 0.5 × Δepoch
```

Paid in `RoutingToken` from the **source** sleeve. The target pays nothing — re-sleeving is inbound-free, by design (refugee-of-experience principle).

## Cross-Shard Atomicity

Step 4 is the only step that touches the global ledger (medulla-pow). If steps 1–3 succeed but step 4 fails (medulla unreachable), steps 1–3 are rolled back. Step 5–6 are local DB writes inside a Prisma transaction.

## Concurrency

Two needlecasts targeting the same source sleeve are serialized at the Postgres row level (`SELECT … FOR UPDATE` on the sleeve row). Two needlecasts on different sleeves under the same Stack proceed in parallel; their `needlecast.route` events are folded into the same epoch's sleeve-root, preserving causality.

See [coherence_root.md](coherence_root.md), [coordination_residues.md](coordination_residues.md).
