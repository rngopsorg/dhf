# Token / Bandwidth Model

## Five Tokens

| Token | Purpose | Decays? | Mint origin |
|---|---|---|---|
| **ComputeToken** | Pays for `perceive` / inference | yes (EBC) | Treasury per-epoch |
| **MemoryToken** | Caps recall depth | yes | Treasury per-epoch |
| **SyncToken** | Pays for `sync` (drift→0) | yes | Treasury per-epoch |
| **RoutingToken** | Pays for `needlecast` | yes | Treasury per-epoch |
| **ResidueToken** | Coordination repair reward | **no** | Residue resolution |

Balances are keyed by **NFT `tokenId`**, not wallet — a Stack's bandwidth follows its identity, not its host. Authorized sleeves spend on behalf of the Stack.

## Coherence Profile Vector

Each Stack NFT carries a 5-coefficient vector:

```solidity
struct CoherenceProfile { uint computeCoeff; uint memoryCoeff; uint syncCoeff; uint routingCoeff; uint residueCoeff; } // ×1e6
```

Coefficients $\in [0, 2]$ scale the per-epoch issuance — high-utility sleeves earn faster, but specialization has cost (a `mining`-tuned stack with `computeCoeff=2` typically has `memoryCoeff < 1`).

## Epoch Binding Curve

```solidity
struct EpochBinding { uint decayRateX1e6; uint floorX1e6; }   // both ×1e6
effective(t) = max(floor, exp(-decayRate · (t - issuedEpoch)))
```

The curve forces tokens to be **used or lost**. The floor (default 0.25) guarantees minimum usability so a quiescent stack does not asymptote to zero.

## Effective Balance

```
effective.k = raw.k × cpv.kCoeff × max(floor, exp(-decay × Δepoch))      ; k ∈ {compute,memory,sync,routing}
effective.residue = raw.residue × cpv.residueCoeff                       ; residue does NOT decay
```

ResidueToken is exempt from decay because **coordination repair must remain incentivized indefinitely**.

See [token_economy.md](token_economy.md), [incentive_loop.md](incentive_loop.md).
