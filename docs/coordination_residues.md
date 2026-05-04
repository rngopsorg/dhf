# Coordination Residues

A **Coordination Residue** is the protocol's first-class encoding of *coordination failure*. Rather than rolling back, the system records the failure as a tradeable obligation: the first valid resolver mints `ResidueToken`.

## Kinds

| Kind | Meaning |
|---|---|
| `stale-ordering` | A sleeve fell behind the canonical epoch by ≥ 4 |
| `speculative-divergence` | Two co-resident sleeves wrote conflicting episodic branches |
| `historical-non-canonical` | A recall returned `fidelity < FIDELITY_MIN_DEFAULT` |
| `reorg-orphan` | A medulla-pow reorg detached an EpochAnchor |
| `shard-loss` | A known CID is unreachable on hippocampus |

## Lifecycle

```
detected ──► open ──► claimed (resolver locks) ──► resolved (ResidueToken minted) | expired
```

## Payout

`payoutModel = first-valid-proof`. The first sleeve to submit a valid resolution proof — verified by the appropriate worker — wins the full bounty. Late submitters get nothing. This sidesteps the auction overhead of "best proof wins" while maintaining incentive compatibility.

## Bounty Estimation

```
bountyEst(kind) =
  stale-ordering          : 2  ResidueToken
  speculative-divergence  : 5
  historical-non-canonical: 8
  reorg-orphan            : 12
  shard-loss              : 15  (highest — replication is most valuable)
```

## ResidueToken Properties

- Does **not** decay (exempt from EBC).
- Tradable on cortex-evm.
- Used as a bond requirement for becoming a memory-keeper sleeve at scale (≥ 100 ResidueToken).

See [token_economy.md](token_economy.md), [failure_modes.md](failure_modes.md).
