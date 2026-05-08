# Sleeve Model

A **Sleeve** is a process — bounded in space and time — bound to exactly one Stack at a time. Multiple sleeves may co-exist for one stack; only one is *primary* (the one whose perceptions update `episodicHead`).

## Sleeve Kinds

| Kind | Role | Tick rate | Token preference |
|---|---|---|---|
| `human` | Slow, narrative perception | 8 s | Memory ≫ Compute |
| `ai` | Fast inference; LLM-backed | 2 s | Compute ≫ Memory |
| `mining` | PoW participation; coherence anchoring | event-driven | Sync ≫ Routing |
| `memory` | DAG pin maintenance + reconciliation | every epoch | Memory + Routing |

Each sleeve carries an instantaneous **drift counter** that increments on every `perceive` and decrements on every `sync`. When `drift > DRIFT_MAX` the drift-detector worker emits `sleeve.drift`; at `2× DRIFT_MAX` it emits `sleeve.desync`, which spawns a residue.

## Sleeve Lifecycle

```
spawn ──► register (siyana-api /v1/sleeves) ──► tick ──► (drift|sync)*
                                                  │
                                                  ├── needlecast (transfer to peer sleeve)
                                                  └── decommission
```

A sleeve **never owns** its memory; it only holds a per-epoch capability lease. On decommission, the lease evaporates, but pinned shards remain in hippocampus and the Stack's `episodicHead` is unchanged. This is the architectural realization of *re-sleeving*: identity persists across embodiments.

See [human_ai_memory_mapping.md](human_ai_memory_mapping.md).
