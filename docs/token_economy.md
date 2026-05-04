# Token Economy

ECCA's economy is a **bandwidth economy**: tokens represent the right to consume specific kinds of compute / memory / sync / routing, not generic value. Token transfers do not move "money" — they move *capacity*.

## Per-Epoch Issuance

The Quellist Treasury issues a fixed `EMISSION_PER_EPOCH = 100` units of each core token (Compute, Memory, Sync, Routing) per stack, scaled by the stack's CPV and EBC:

$$
\text{issued}_k(\text{epoch}, t) = 100 \cdot \text{cpv}_k \cdot \max(\text{floor}, e^{-\text{decay} \cdot \Delta t})
$$

A stack with a balanced CPV and decay 0.05 receives ≈ 100 units of each core token at issuance time, decaying to 25 units after ≈ 28 epochs of inactivity.

## Demand Model

Token consumption per primitive (default rates):

| Primitive | Compute | Memory | Sync | Routing |
|---|---|---|---|---|
| `perceive` | 0.5 | 0 | 0 | 0 |
| `recall(d)` | 0 | d | 0 | 0 |
| `sync` | 0 | 0 | 1 | 0 |
| `needlecast(n shards)` | 0 | 0 | 0 | 5 + 0.1n |
| `pin(cid)` | 0 | 0.5 | 0 | 0 |
| `mineblock` | 1 | 0 | 0 | 0 |

## Treasury Sources

- **Genesis allocation**: 1M of each core token, owned by `QuellistTreasury` contract.
- **Per-epoch emission**: 100 each, capped by stack registry size × emission per epoch (issued lazily on `claimEpochRewards`).
- **ResidueToken**: minted only on residue resolution (not pre-allocated, not periodic).

## Sinks

- Token spent on a primitive is **burned** from the stack's bandwidth ledger (it does not return to treasury).
- This makes coordination work the only path to sustained activity — a stack that does nothing productive runs out of bandwidth.

See [token_bandwidth_model.md](token_bandwidth_model.md), [incentive_loop.md](incentive_loop.md).
