# Failure Modes

## Taxonomy

| Mode | Symptom | Detection | Mitigation |
|---|---|---|---|
| **Drift** | `sleeve.drift > DRIFT_MAX` | drift-detector worker | sleeve runs `/sync`; SyncToken consumed |
| **Desync** | `drift > 2× DRIFT_MAX` | drift-detector | open residue `speculative-divergence`; resolution mints ResidueToken |
| **Stale Ordering** | `syncEpoch < currentEpoch − 4` | residue-collector on epoch tick | open residue `stale-ordering`; auto-resolved by next sync |
| **Historical Non-Canonical** | `fidelity < FIDELITY_MIN_DEFAULT` on recall | dhf-compositor | open residue `historical-non-canonical`; memory-keeper bounty |
| **Reorg Orphan** | medulla-pow reorg detached anchor | epoch-anchor worker on `chain.reorg` | open residue `reorg-orphan`; thalamus re-folds events |
| **Shard Loss** | hippocampus returns 404 for known CID | memory-reconciler | open residue `shard-loss`; first peer to re-pin earns bounty |

## Cascading Failures

A wedged hippocampus does **not** cascade to medulla-pow: medulla mines empty coherence tuples. Conversely, a stalled medulla halts epoch transitions but cortex-evm and hippocampus continue serving reads. The system trades **liveness for safety** at coherence boundaries.

## Recovery SLOs

- Drift recovery: **< 1 epoch** (4 s default)
- Stale-ordering recovery: **≤ 4 epochs**
- Reorg recovery: **≤ depth × epoch** (typical: 12 s for 3-block reorg)
- Shard re-pin: **≤ pinning-service tick** (≤ 1 epoch)

See [coordination_residues.md](coordination_residues.md), [runbook.md](runbook.md).
