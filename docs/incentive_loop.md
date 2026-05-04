# Incentive Loop

The protocol is a closed feedback loop. Each role pays in one token and earns in another, creating a cycle that cannot be drained without doing useful work.

```
                       Treasury (CPV-weighted emission)
                       ┌─────────────────────────────────┐
                       │                                 │
                       ▼                                 │
  ─────────────► Compute, Memory, Sync, Routing ─────────│
                       │                                 │
              consumed by sleeves                        │
                       │                                 │
              ┌────────┴────────┐                        │
              ▼                 ▼                        │
       perceive/recall/    drift/desync                  │
          sync/route        residues open                │
              │                 │                        │
              │                 ▼                        │
              │         resolvers earn ResidueToken ─────┘
              │                 │
              └────► usage logs ┘
                       │
                       ▼
              auditLog → next-epoch CPV adjustment
```

## Actor Strategies

| Actor | Earns | Pays | Loop |
|---|---|---|---|
| Operator (stack owner) | All four core tokens (treasury) | None directly | Provides CPV signal via stack config |
| AI sleeve | None directly | Compute (heavy) | Earns by good predictions reducing residues |
| Memory sleeve | ResidueToken (shard-loss bounties) | Memory (pin bond) | Pin = bond against shard-loss |
| Mining sleeve | RoutingToken? No: PoW reward unspecified — treasury issues `MiningRouting` bonus | Compute | Earns by mining coherence anchors |
| Resolver (any sleeve) | ResidueToken | Compute (proof gen) | Pure repair work |

## Equilibrium

A rational actor chooses CPV coefficients matching its workload. Mis-tuned CPV is *self-punishing*: a `mining` sleeve with high `memoryCoeff` earns lots of `MemoryToken` but cannot consume them productively (they decay to floor). The market clears in the per-stack CPV-tuning game.

See [token_economy.md](token_economy.md), [security_model.md](security_model.md).
