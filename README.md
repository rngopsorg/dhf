# DHF — Digital Human Freight

> **Eternal Coherence over Cryptographic Anchors (ECCA Stack v3)**
>
> A distributed cognitive operating system that treats identity as coherence,
> memory as a content-addressed DAG, and coordination failures as tradeable bounties.

DHF is a research-grade implementation of the *Altered Carbon* Stack / Sleeve / Needlecast metaphor, built on three independent ledgers (`medulla-pow`, `hippocampus-dag`, `cortex-evm`) bound by a fourth append-only structure — the **Synaptic Field** (Merkle Mountain Range). The system encodes persistent digital identity, episodic memory, multi-sleeve embodiment, and a full token economy where bandwidth — not money — is the unit of account.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Terminology — Dual Neuroscience / Crypto Mapping](#terminology)
3. [Architecture](#architecture)
4. [The Three Chains](#the-three-chains)
5. [Services](#services)
6. [Token Economy](#token-economy)
7. [Needlecasting (Re-Sleeving)](#needlecasting)
8. [Coordination Residues](#coordination-residues)
9. [Cryptographic Primitives](#cryptographic-primitives)
10. [Quickstart](#quickstart)
11. [Repo Layout](#repo-layout)
12. [Ports & Endpoints](#ports--endpoints)
13. [Documentation](#documentation)

---

## Core Concepts

### Digital Human Freight (DHF)

DHF is the canonical encoding of a Stack's mind. It is NOT a serialized blob — it is a **capability-bound walk** over the hippocampus-dag, gated by:

- The Stack's identity pubkey (ed25519)
- The current epoch (±alignment window)
- MemoryToken balance (caps traversal depth)
- CPV memoryCoeff (scales recall fidelity)

Reconstruction is performed by the `dhf-compositor` service: resolve `episodicHead` → BFS walk to `depth = min(requested, memoryToken)` → validate epoch window → decrypt with per-epoch HKDF key → score fidelity.

### Stack

A **Stack** is a persistent cryptographic identity — the equivalent of a DHF cortical stack. On-chain, it is an ERC-721 NFT (`StackIdentity`) carrying:

- `pubkey` — ed25519 identity key
- `latestRoot` — most recent cross-chain coherence root
- `epoch` — monotonic epoch counter
- `CPV` — Coherence Profile Vector (5 coefficients scaling token interaction)
- `EBC` — Epoch Binding Curve (decay rate + floor for token effectiveness)

A Stack persists independent of any embodiment. Memory, tokens, and history belong to the Stack — never to a Sleeve.

### Sleeve

A **Sleeve** is a process bound to a Stack by a per-epoch capability key. It is the execution context — the body the mind inhabits. Four kinds exist:

| Kind | Role | Tick Rate | Token Preference |
|------|------|-----------|-----------------|
| `human` | Slow narrative perception | 8s | Memory ≫ Compute |
| `ai` | Fast LLM inference | 2s | Compute ≫ Memory |
| `mining` | PoW participation | event-driven | Sync ≫ Routing |
| `memory` | DAG pin maintenance | every epoch | Memory + Routing |

Sleeves accumulate **drift** on every `perceive` call. Drift decrements on `sync`. If drift exceeds `DRIFT_MAX_DEFAULT`, the sleeve enters a warning state. At `2× DRIFT_MAX` it **desyncs** — a coordination residue is spawned and the sleeve must re-synchronize or be decommissioned.

A Stack can run multiple co-resident sleeves simultaneously. Only the primary advances `episodicHead`; others run in shadow mode with ephemeral branches merged at sync.

### Epoch

An **epoch** is a 4-second coherence cycle. Every epoch:

1. Thalamus-router folds cross-shard events
2. Computes `coherenceRoot` binding all four shard roots
3. Medulla-pow mines a PoW block containing the root
4. Epoch increments; MMR appends; workers run passes
5. Treasury issues token rewards

### Coherence Root

The per-epoch 32-byte hash that binds all shards:

```
crossRoot = sha256("ecca-coh-v1" ‖ evmRoot ‖ btcRoot ‖ ipfsRoot ‖ sleevesRoot)
```

One PoW finality finalizes three shards simultaneously. Two distinct tuples for the same epoch from the same operator trigger a `routing-equivocation` residue and operator slash.

---

## Terminology

Every component is **dual-coded** — named for both its neurological analog and its cryptographic function:

| Term | Neuroscience | Crypto / Systems |
|------|-------------|-----------------|
| **Stack** | Persistent identity (cortical stack) | ERC-721 NFT with CPV + EBC |
| **Sleeve** | Embodiment / body | Process bound via per-epoch capability key |
| **Cortex** | Cerebral cortex | EVM chain (chain id 1337) |
| **Hippocampus** | Episodic memory formation | Content-addressed DAG with epoch-tagged CIDs |
| **Medulla** | Brainstem (autonomic rhythm) | PoW chain providing sequencing + coherence anchoring |
| **Thalamus** | Sensory relay nucleus | Cross-shard event router + coherence folder |
| **Synapse** | Inter-neuron junction | API gateway (REST + WS) |
| **Synaptic Field** | Cortico-thalamic binding | Merkle Mountain Range over medulla block hashes |
| **Axonal Bus** | Inter-region white matter | NATS JetStream (`ecca.*` streams) |
| **CPV** | Cortical column tuning | 5-coefficient bandwidth scaling vector |
| **EBC** | Synaptic decay curve | Token effectiveness decay (decayRate, floor) |
| **Drift** | Cognitive dissonance | Per-sleeve divergence counter |
| **Desync** | Dissociative episode | drift > 2× DRIFT_MAX → residue spawned |
| **Needlecast** | Re-sleeving / DHF transfer | 6-step atomic saga with rollback |
| **Residue** | Coordination scar tissue | First-class failure object with token bounty |
| **Cortical Registry** | Region atlas | Postgres |
| **Working Memory Cache** | Phonological loop | Redis |
| **Shard Vault** | Long-term storage | MinIO |
| **Fidelity** | Memory accuracy | `|fragments| / (|fragments| + |broken|)` |
| **Epoch Key** | Per-session encryption | `HKDF-SHA512(masterSecret, stackId, "ecca-epoch-"+epoch)` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  siyana-api  (REST + WebSocket gateway)                            │
├─────────────────────────────────────────────────────────────────────┤
│  thalamus-router · dhf-compositor · needlecast-router-svc           │
│  quellist-treasury-svc · bandwidth-faucet                           │
├─────────────────────────────────────────────────────────────────────┤
│  sleeve-runtime (4 parametric kinds)  │  workers/runner (6 kinds)   │
├───────────────────┬─────────────────────┬───────────────────────────┤
│  medulla-pow      │  hippocampus-dag    │  cortex-evm               │
│  (Go PoW + MMR)   │  (Go DAG + CIDs)    │  (geth --dev, Cancun)     │
├───────────────────┴─────────────────────┴───────────────────────────┤
│  Postgres · Redis · NATS JetStream · MinIO · Prometheus/Grafana/Loki│
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Model

| Layer | Name | Neuroscience Analog | Function |
|-------|------|-------------------|----------|
| L0 | Medulla | Brainstem | Sequencing & coherence anchoring (PoW) |
| L1 | Hippocampus | Episodic memory | Content-addressed DAG storage |
| L2 | Cortex | Cerebral cortex | Identity, contracts, token logic (EVM) |
| L3 | Synaptic Field | Cortico-thalamic loop | Cross-shard event integral (MMR in L0) |

### Coordination Loop (per epoch, every 4s)

1. Sleeves perceive → events flow via NATS (`ecca.perceive.*`)
2. Thalamus collects epoch events, computes Merkle roots per shard
3. `coherenceRoot()` folds all four roots into a single 32-byte digest
4. Medulla mines a PoW block with the coherence tuple in the header
5. Epoch increments → MMR appends new leaf → `EpochAnchor.commitAnchor(...)` on cortex
6. Workers run passes: drift-checker, epoch-anchor, residue-collector, memory-reconciler, treasury-emitter, sleeve-watchdog
7. Treasury issues per-stack token rewards scaled by CPV × EBC

---

## The Three Chains

### medulla-pow (Go)

The brainstem — provides sequencing and coherence anchoring via Proof of Work.

- Bitcoin-style PoW with 128-byte coherence tuple embedded in each block header
- Only mines on `submitcoherenceroot` — PoW alone cannot advance the tip
- Maintains a **Synaptic Field MMR** (256-leaf rolling window) in-chain
- Difficulty retargets every 60 blocks toward 16s per block
- RPC: `getinfo`, `getlatestanchor`, `getepochanchor`, `submitcoherenceroot`, `getsynapticproof`, `mineblock`

### hippocampus-dag (Go)

The episodic memory — a content-addressed DAG with epoch-tagged, token-gated retrieval.

- IPFS-style DAG with multicodec `0xECCA`
- CID format: `ecca://<sha256>@<epoch>`
- DAG node: `{ cid, ciphertext: AES-256-GCM(plaintext, epochKey), links, epoch, kind, pinned, stackId }`
- Three secondary indices: byEpoch, byStack, byKind (O(log n) range scans)
- Token-gated retrieval enforced at routing layer (MemoryToken balance caps depth)
- HTTP API: `dag/put`, `dag/get`, `pin/add`, `dhf/recall`

### cortex-evm (geth)

The cerebral cortex — identity, contracts, and token logic on a standard EVM.

- Upstream geth 1.14.8 in `--dev` mode (Cancun-compatible, 4s block period)
- Chain ID 1337
- Seven contracts: StackIdentity, BandwidthToken (×5), QuellistTreasury, NeedlecastRouter, SleeveRegistry, ResidueRegistry, EpochAnchor
- Pre-funded dev account auto-funds the deployer

---

## Services

### siyana-api

The **synapse** — API gateway exposing REST and WebSocket interfaces. Handles stack CRUD, sleeve management, `perceive`, `recall`, `remember`, and token queries. WebSocket at `/ws` fans out all bus events as JSON lines.

### thalamus-router

The **thalamus** — sensory relay that folds per-epoch cross-shard events into coherence roots. Collects EVM tx hashes, hippocampus CIDs, and sleeve events; computes Merkle roots; submits to medulla for PoW finality.

### dhf-compositor

Reconstructs a Stack's DHF from the DAG. Walks `episodicHead` via BFS, validates epoch windows, decrypts fragments with per-epoch HKDF keys, and scores fidelity. If fidelity drops below `FIDELITY_MIN_DEFAULT` (0.6), a `historical-non-canonical` residue is spawned.

### needlecast-router-svc

Executes the 6-step needlecast (re-sleeving) saga with full rollback on failure. Coordinates freeze → shard → pin → anchor → reconstruct → settle.

### quellist-treasury-svc

Named for Quellcrist Falconer. Issues bandwidth tokens against epoch progress and residue resolution proofs. Manages per-stack `claimEpochRewards` and direct `issue` calls for residue payouts.

### bandwidth-faucet

Rate-limited token faucet for development and bootstrapping. Drips small amounts of each token to newly created stacks.

### sleeve-runtime

A 4-in-1 parametric runtime that ticks at the appropriate rate for its sleeve kind (human/ai/mining/memory). Handles perception ingestion, drift accumulation, sync operations, and decommission.

### workers/runner

A 6-in-1 worker dispatcher (switched by `WORKER_KIND` env var):

| Worker | Function |
|--------|----------|
| `drift-checker` | Flags sleeves exceeding DRIFT_MAX |
| `epoch-anchor` | Commits coherence roots to cortex-evm EpochAnchor contract |
| `residue-collector` | Detects and opens new coordination residues |
| `memory-reconciler` | Merges shadow-mode branches on sync |
| `treasury-emitter` | Triggers lazy epoch reward claims |
| `sleeve-watchdog` | Decommissions desync'd sleeves |

---

## Token Economy

DHF uses a **five-token bandwidth system** where tokens represent capacity, not money. Balances are keyed by NFT `tokenId` (not wallet) — bandwidth follows identity.

### The Five Tokens

| Token | Symbol | Purpose | Decays? | Source |
|-------|--------|---------|---------|--------|
| ComputeToken | CMP | Pays for perceive / inference | Yes (EBC) | Treasury emission |
| MemoryToken | MEM | Caps recall depth | Yes (EBC) | Treasury emission |
| SyncToken | SYN | Pays for sync operations | Yes (EBC) | Treasury emission |
| RoutingToken | RTE | Pays for needlecast | Yes (EBC) | Treasury emission |
| ResidueToken | RES | Repair reward / memory-keeper bond | **No** | Residue resolution |

### Coherence Profile Vector (CPV)

Five coefficients ∈ [0, 2] stored on each Stack NFT. They scale per-epoch token issuance:

```
issued_k = emissionPerEpoch × cpv_k × EBC_decay
```

A Stack optimized for AI work might set `computeCoeff = 1.8, memoryCoeff = 0.5`, earning more Compute per epoch at the expense of Memory.

### Epoch Binding Curve (EBC)

Token effectiveness decays over time:

$$\text{effective}(t) = \max(\text{floor},\ e^{-\text{decayRate} \times \Delta\text{epoch}})$$

Default: `decayRate = 0.05`, `floor = 0.25`. Idle stacks lose capacity — use it or lose it.

### Consumption Rates

| Operation | Cost |
|-----------|------|
| `perceive` | 0.5 Compute |
| `recall(depth=d)` | d × 1 Memory |
| `sync` | 1 Sync |
| `needlecast` | 5 + 0.1×shards + 0.5×|Δepoch| Routing |
| `pin` | 0.5 Memory |
| `mineblock` | 1 Compute |

Tokens are **burned** on consumption — they never return to treasury. A stack that does nothing eventually runs out of bandwidth.

---

## Needlecasting

Needlecasting is the atomic transfer of executive control from one Sleeve to another — the DHF equivalent of "re-sleeving." It executes as a **6-step saga with full rollback**:

| Step | Action | Rollback |
|------|--------|----------|
| 1 | `freeze(source)` — mark sleeve dead | Unfreeze |
| 2 | `shard(episodicHead, depth=8)` — collect CIDs | Read-only |
| 3 | `pin(shards)` — durability bond | Unpin |
| 4 | `anchor(saga)` — emit route for thalamus | Drop fold |
| 5 | `reconstruct(target)` — target.drift=0, sync epoch | Restore |
| 6 | `settle(source)` — debit RoutingToken | Re-credit |

**Cost model:** `5 + 0.1 × shard_count + 0.5 × |Δepoch|` in RoutingToken from source. Target pays nothing — the "refugee-of-experience" principle.

**Concurrency:** Same-source needlecasts are serialized via `SELECT FOR UPDATE`. Different sleeves under the same Stack can needlecast in parallel.

---

## Coordination Residues

Coordination failures are not rolled back — they become **first-class tradeable failure objects** with token bounties. This reframes MEV: residues are not extracted, they are *resolved into canonical state*.

### Five Kinds

| Kind | Meaning | Bounty (RES) |
|------|---------|:---:|
| `stale-ordering` | Sleeve behind by ≥4 epochs | 2 |
| `speculative-divergence` | Co-resident sleeves wrote conflicting branches | 5 |
| `historical-non-canonical` | Recall fidelity < 0.6 | 8 |
| `reorg-orphan` | Medulla reorg detached an anchor | 12 |
| `shard-loss` | Known CID unreachable on hippocampus | 15 |

### Lifecycle

```
detected → open → claimed → resolved (ResidueToken minted)
                          → expired (if unclaimed after TTL)
```

**Payout model:** `first-valid-proof` — the first resolver to submit a valid proof wins the full bounty as ResidueToken.

---

## Cryptographic Primitives

| Primitive | Library | Usage |
|-----------|---------|-------|
| SHA-256 | noble/hashes | CIDs, coherence root, Merkle leaves |
| ed25519 | noble/curves | Stack identity keypairs, signatures |
| AES-256-GCM | Node crypto | DAG node encryption (random 12-byte nonce) |
| HKDF-SHA-512 | noble/hashes | Per-epoch key derivation from Stack secret |
| RFC-6962 Merkle | Custom | Domain-separated (0x00 leaf, 0x01 internal) |
| MMR | Custom (Go) | Synaptic Field — 256-leaf rolling window |

### Epoch Key Derivation

```
epochKey = HKDF-SHA512(
  ikm:  masterSecret,
  salt: stackId,
  info: "ecca-epoch-" + epoch
)
```

Each epoch produces a unique symmetric key. Only the Stack holder (possessing `masterSecret`) can derive keys for their own epochs.

### Synaptic Field (MMR)

A 256-leaf rolling-window Merkle Mountain Range over medulla block hashes. Provides O(log₂ 256) = 8 hash-op inclusion proofs for any block without full chain history. Peaks are bagged right-to-left; oldest peak is dropped at capacity.

---

## Quickstart

```bash
# Prerequisites: Node.js ≥20, pnpm 9.7+, Docker with Compose v2

cp .env.example .env
pnpm install
pnpm build

# Start infrastructure + chains + services
docker compose up -d

# Deploy contracts to cortex-evm
pnpm contracts:deploy

# Run the end-to-end demo (create → perceive → recall → needlecast → epoch)
pnpm demo
```

Open http://localhost:3030 (Grafana) for the **Coherence Overview** dashboard.

### Boot Order

1. Infrastructure: Postgres, Redis, NATS, MinIO
2. Chains: medulla-pow, hippocampus-dag, cortex-evm
3. Contract deployment: contracts-deployer
4. Services: siyana-api, thalamus-router, dhf-compositor, etc.
5. Workers: drift-checker, epoch-anchor, residue-collector, etc.

---

## Repo Layout

```
dhf/
├─ packages/                  # Shared TS libraries
│  ├─ proto/                  #   Tokens, events, constants, zod schemas
│  ├─ crypto/                 #   SHA-256, HKDF, AES-GCM, ed25519, Merkle, MMR, CID
│  ├─ bus/                    #   NATS JetStream wrapper (AxonalBus)
│  ├─ db/                     #   Prisma schema + getDb() singleton
│  ├─ chain/                  #   viem clients (HippocampusClient, MedullaClient)
│  └─ service-base/           #   Fastify bootstrap helpers
├─ services/
│  ├─ siyana-api/            #   REST + WS gateway
│  ├─ thalamus-router/        #   Epoch tick + coherence folding
│  ├─ dhf-compositor/         #   DAG walk + decrypt + fidelity scoring
│  ├─ needlecast-router-svc/  #   6-step re-sleeving saga
│  ├─ quellist-treasury-svc/  #   Token emission + epoch rewards
│  ├─ bandwidth-faucet/       #   Rate-limited token drip
│  └─ sleeve-runtime/         #   4-in-1 parametric sleeve
├─ workers/runner/            # 6-in-1 worker dispatcher
├─ contracts/                 # Solidity 0.8.24 (OpenZeppelin v5, Hardhat)
│  └─ src/                    #   StackIdentity, BandwidthToken, QuellistTreasury,
│                             #   NeedlecastRouter, SleeveRegistry, ResidueRegistry, EpochAnchor
├─ forks/
│  ├─ medulla-pow-go/         #   PoW chain + Synaptic Field MMR (Go, stdlib only)
│  ├─ hippocampus-dag-go/     #   Epoch-tagged content-addressed DAG (Go, stdlib only)
│  └─ cortex-evm-go/          #   geth genesis + Dockerfile (--dev mode, Cancun)
├─ deploy/
│  ├─ observability/          #   Prometheus, Loki, Grafana provisioning
│  └─ k8s/                    #   6 Helm charts + values-shared.yaml
├─ tests/integration/         # Vitest E2E
├─ scripts/demo.ts            # End-to-end coherence cycle demo
├─ docker-compose.yml         # 24 services, laptop-first
├─ docker-compose.distributed.yml  # Swarm overlay variant
└─ docs/                      # 20 documentation files
```

---

## Ports & Endpoints

| Service | Port | Health |
|---------|------|--------|
| siyana-api | 7070 | `/healthz` |
| needlecast-router-svc | 7071 | `/healthz` |
| thalamus-router | 7072 | `/healthz` |
| dhf-compositor | 7073 | `/healthz` |
| quellist-treasury-svc | 7074 | `/healthz` |
| bandwidth-faucet | 7075 | `/healthz` |
| medulla-pow (RPC) | 8332 | `/health` |
| hippocampus-dag (HTTP) | 5001 | `/health` |
| cortex-evm (JSON-RPC) | 8545 | — |
| Grafana | 3030 | — |
| Prometheus | 9090 | — |
| NATS | 4222 | — |
| Postgres | 5432 | — |
| Redis | 6379 | — |
| MinIO | 9000 | — |

### Key API Routes

```
POST   /v1/stacks                  # Create a Stack
POST   /v1/stacks/:id/sleeves      # Spawn a Sleeve
POST   /v1/stacks/:id/perceive     # Write a perception (costs Compute)
POST   /v1/stacks/:id/recall       # Read memory (costs Memory, depth-bounded)
POST   /v1/stacks/:id/remember     # Pin to DAG
POST   /v1/needlecast              # Initiate re-sleeving saga
GET    /v1/epochs/current           # Current epoch + coherence root
GET    /v1/tokens/balances/:stackId # All five token balances
POST   /v1/faucet/drip             # Dev: drip tokens
WS     /ws                          # Real-time bus events
```

---

## Documentation

| Document | Topic |
|----------|-------|
| [architecture.md](docs/architecture.md) | System topology, layer model, coordination loop |
| [dhf_overview.md](docs/dhf_overview.md) | DHF encoding, capability-bound walks, fidelity |
| [glossary.md](docs/glossary.md) | Complete dual-coded terminology reference |
| [coherence_root.md](docs/coherence_root.md) | Per-epoch hash formula, anti-equivocation |
| [coordination_residues.md](docs/coordination_residues.md) | Failure kinds, bounties, lifecycle |
| [cross_chain_sync.md](docs/cross_chain_sync.md) | Three-chain synchronization at epoch boundaries |
| [needlecasting_spec.md](docs/needlecasting_spec.md) | 6-step saga, cost model, concurrency |
| [sleeve_model.md](docs/sleeve_model.md) | Sleeve kinds, drift, lifecycle |
| [token_bandwidth_model.md](docs/token_bandwidth_model.md) | Five tokens, CPV, EBC, effective balance |
| [token_economy.md](docs/token_economy.md) | Issuance, consumption rates, sinks |
| [synaptic_field_mmr.md](docs/synaptic_field_mmr.md) | MMR structure, rolling window, proofs |
| [memory_graph_theory.md](docs/memory_graph_theory.md) | Formal graph model, fidelity decay, pruning |
| [chain_forks.md](docs/chain_forks.md) | medulla-pow, hippocampus-dag, cortex-evm details |
| [human_ai_memory_mapping.md](docs/human_ai_memory_mapping.md) | Human↔AI sleeve equivalence, co-residency |
| [security_model.md](docs/security_model.md) | Trust boundaries, threat model, audit |
| [incentive_loop.md](docs/incentive_loop.md) | Closed feedback loop, actor strategies |
| [failure_modes.md](docs/failure_modes.md) | Failure taxonomy, cascading behavior, SLOs |
| [deployment.md](docs/deployment.md) | Local, Swarm, and K8s deployment |
| [api_reference.md](docs/api_reference.md) | Full REST/WS/RPC API surface |
| [runbook.md](docs/runbook.md) | Operational procedures, incidents, backup |

---

## Design Principles

1. **Identity is coherence, not location.** A Stack is defined by the consistency of its memory graph, not where it runs.
2. **Memory survives partial chain death.** Hippocampus and cortex don't roll back on medulla reorgs — discrepancies become residues.
3. **Failure is first-class.** Coordination failures are tradeable objects, not hidden errors. Resolution is incentivized, not mandated.
4. **Bandwidth, not money.** Tokens represent capacity to act. Idle stacks decay. Active stacks earn.
5. **Sleeves are ephemeral, Stacks are eternal.** The body is temporary; the mind persists.
6. **One PoW finality finalizes three shards.** The coherence root binds EVM, DAG, and sleeve state in a single proof.
7. **Liveness traded for safety at coherence boundaries.** Epoch ticks may stall, but memory never corrupts.

---

## Environment Requirements

- **Node.js** ≥ 20.10
- **pnpm** 9.7.0+
- **Go** 1.22+ (for fork builds)
- **Docker** with Compose v2
- **Solidity** 0.8.24 (via Hardhat, installed by `pnpm install`)

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
