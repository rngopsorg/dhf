# ECCA Stack v3 — Architecture

> "We are not the bodies. We are the coherent pattern that runs across them."

ECCA Stack v3 is a distributed cognitive operating system that models identity, memory, and behavior as **coherence over a substrate of three independent ledgers** — a Proof-of-Work anchor chain (`medulla-pow`), a content-addressed memory DAG (`hippocampus-dag`), and an EVM-compatible account/state chain (`cortex-evm`) — bound together by a fourth layer, the **Synaptic Field**, an append-only Merkle Mountain Range (MMR) of every cross-shard transition.

## 1. The Three-Plus-One Layer Model

| Layer | Substrate | Role | Analog |
|---|---|---|---|
| **L0 — Medulla** | PoW chain | Sequencing & coherence anchoring | Brainstem / autonomic |
| **L1 — Hippocampus** | DAG | Episodic + semantic memory storage | Hippocampus |
| **L2 — Cortex** | EVM | Identity, contracts, token logic | Cerebral cortex |
| **L3 — Synaptic Field** | MMR (in L0) | Cross-shard event integral | Cortico-thalamic loop |

A **Stack** is the unique cryptographic identity that points at a coordinated tuple `(stackId, episodicHead, currentEpoch, CPV, EBC)`. A **Sleeve** is a process — human, AI, mining, or memory-keeper — bound to a Stack by a per-epoch capability key.

## 2. Process Topology

```
                 ┌─── synapse-api (REST/WS/GraphQL) ───┐
   Operator ─── │     ↑                                │
                 └────┬─────────────┬──────────────────┘
                      │             │
            thalamus-router      dhf-compositor
                      │             │
   ┌──────────────────┼─────────────┴──── needlecast-router-svc ───┐
   ↓                  ↓                  ↓                         ↓
medulla-pow    hippocampus-dag      cortex-evm                  workers (×6)
 (Go,:8332)       (Go,:5001)       (geth,:8545)            BullMQ / NATS JS
```

All inter-service messaging flows on **NATS JetStream** (`axonal-bus`, durable streams under subject `ecca.*`).

## 3. Coordination Loop

Every `EPOCH_INTERVAL_MS` (4 s default):

1. The thalamus-router folds the epoch's accumulated chain events into per-shard Merkle roots.
2. It computes `coherenceRoot(evm, btc, ipfs, sleeves)` and submits it to medulla-pow via `submitcoherenceroot`.
3. medulla-pow mines a PoW block over the new tuple, appends the block hash to the Synaptic Field MMR, and increments the epoch.
4. The new epoch is fanned out to subscribers; workers run their per-epoch passes (anchor recording, drift detection, residue collection, memory reconciliation, pin maintenance, bandwidth accounting).
5. The Quellist Treasury issues per-stack rewards weighted by the Stack's Coherence Profile Vector (CPV) and decayed by its Epoch Binding Curve (EBC).

## 4. Failure-Domain Isolation

- Each shard fails independently. A wedged hippocampus does **not** halt the cortex.
- Coherence violations are surfaced as **Coordination Residues** rather than rolled back: the system records them, opens a bounty, and rewards the first valid resolver in `ResidueToken`.

See [chain_forks.md](chain_forks.md), [coherence_root.md](coherence_root.md), [coordination_residues.md](coordination_residues.md), [token_economy.md](token_economy.md).
