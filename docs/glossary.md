# Glossary

> *Every term in ECCA is dual-coded — neuroscience and cryptography point at the same primitive.*

| Term | Neuro | Crypto / Systems |
|---|---|---|
| **Stack** | Persistent identity (Altered Carbon stack) | NFT (`StackIdentity`) carrying CPV + EBC |
| **Sleeve** | Embodiment of a stack | Process bound to stack via per-epoch capability key |
| **Cortex** | Cerebral cortex | EVM chain (`cortex-evm`, chain id 131072) |
| **Hippocampus** | Episodic memory consolidator | Content-addressed DAG (`hippocampus-dag`) |
| **Medulla** | Brainstem / autonomic | PoW chain (`medulla-pow`) |
| **Thalamus** | Sensory relay | Cross-shard event router (`thalamus-router`) |
| **Siyana** | Inter-neuron junction | API gateway (`siyana-api`) |
| **Synaptic Field** | Neural firing pattern integral | Append-only MMR over medulla blocks |
| **Coherence Profile Vector (CPV)** | Cortical column tuning | 5-coefficient bandwidth scaling vector on Stack NFT |
| **Epoch Binding Curve (EBC)** | Synaptic decay | `(decayRate, floor)` token decay schedule on Stack NFT |
| **Drift** | Cognitive dissonance | Per-sleeve counter incremented on `perceive`, decremented on `sync` |
| **Desync** | Dissociative episode | `drift > 2× DRIFT_MAX` |
| **Needlecast** | Re-sleeving / DHF transfer | Saga: freeze → shard → pin → anchor → reconstruct |
| **DHF** | Digital Human Freight (the "mind") | Capability-bound walk over hippocampus-dag |
| **Residue** | Coordination scar tissue | First-class failure object with bounty |
| **Quellist Treasury** | (after Quellcrist Falconer) | Per-epoch token issuer (`QuellistTreasury` contract) |
| **Coherence Root** | Phase-locked oscillation | Per-epoch sha256 over (evm, btc, ipfs, sleeves) shard roots |
| **Episodic Head** | Latest autobiographical memory | Most-recent CID written by primary sleeve |
| **Bandwidth** | Metabolic throughput | Token-denominated capacity (compute/memory/sync/routing) |
| **ResidueToken** | Repair labor receipt | ERC-20-ish minted only on residue resolution |
| **Axonal Bus** | Inter-region signaling | NATS JetStream (`axonal-bus`) carrying `ecca.*` subjects |
| **Shard Vault** | Long-term storage cortex | MinIO (`shard-vault`) backing hippocampus durability |
| **Cortical Registry** | Region-of-interest atlas | Postgres (`cortical-registry-db`) holding stack/sleeve state |
| **Working Memory Cache** | Phonological loop | Redis (`working-memory-cache`) for queues / hot reads |
