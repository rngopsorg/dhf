# Security Model

## Trust Boundaries

| Boundary | Trusted | Untrusted | Mediation |
|---|---|---|---|
| Stack ↔ Sleeve | Stack owner | Sleeve host | Per-epoch HKDF capability key |
| Sleeve ↔ Cortex | Sleeve | Other sleeves | `StackIdentity.authorizedRouters` |
| Cortex ↔ Treasury | Treasury operator | Stack owner | `Ownable` + `mint`/`spend` reasons logged |
| Thalamus ↔ Medulla | Thalamus operator | Network | Operator-signed `submitcoherenceroot` |
| Hippocampus ↔ Sleeve | Sleeve | DAG | `(epoch, stackId, MemoryToken)` retrieval gate |

## Cryptographic Primitives

- **Hashing**: SHA-256 via `@noble/hashes` (audited).
- **Identity**: ed25519 via `@noble/curves`.
- **Symmetric**: AES-256-GCM (Node `crypto`), nonce = random 12 bytes per encryption, versioned payloads (`v: 1`).
- **KDF**: HKDF-SHA-512 (`@noble/hashes/hkdf`).
- **Merkle**: RFC-6962-style domain-separated (`0x00` leaves, `0x01` nodes).

No bespoke crypto. No DIY KDFs. No JS Math.random.

## Threat Models

### T1 — Stack key compromise
Adversary obtains the master secret of a stack. → Adversary can decrypt all past episodes, write new episodes, and authorize sleeves. **Mitigation**: rotate master secret via `StackIdentity.rotatePubkey(newPub, sigOldPub)` (in v3.1); for v3, treat as terminal compromise — rotate sleeves and CPV.

### T2 — Sleeve host compromise
Adversary controls the host running a sleeve. → Can spend bandwidth, perceive arbitrary text, but **cannot** decrypt other epochs (per-epoch keys are isolated). **Mitigation**: stack owner decommissions the sleeve (`DELETE /v1/sleeves/:id`); future epochs are inaccessible.

### T3 — Thalamus equivocation
Operator of thalamus-router signs two distinct `crossRoot` for the same epoch. → Detectable by any node comparing anchors; opens a `routing-equivocation` residue and slashes the operator's bond.

### T4 — Hippocampus eclipse
Adversary partitions a stack from the DAG. → Recall fidelity drops; `historical-non-canonical` residues open. **Mitigation**: pinning-service worker maintains replication factor ≥ 3 across MinIO peers in production.

### T5 — Treasury drain
Adversary mints unlimited tokens. → Prevented by `onlyMinter` modifier; minter is the deployer (rotatable to a multisig).

### T6 — DoS on synapse-api
Public-facing service. → Rate-limited (Fastify rate-limit plugin in production), JWT-required for write paths in production (open in dev).

## Audit Surface

- `auditLog` Postgres table records every token movement, residue lifecycle event, and treasury emission.
- `bus.subscribe('ecca.>', …)` produces a tamper-evident log via the Synaptic Field MMR.
- All contract events are queryable via cortex-evm RPC.

See [coordination_residues.md](coordination_residues.md), [runbook.md](runbook.md).
