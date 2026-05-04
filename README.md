# ECCA Stack v3

> **Eternal Coherence over Cryptographic Anchors**
> A distributed cognitive operating system that treats identity as coherence, memory as a content-addressed DAG, and coordination failures as tradeable bounties.

ECCA Stack is a research-grade implementation of the *Altered Carbon* DHF / Stack / Sleeve metaphor, built on three independent ledgers (`medulla-pow`, `hippocampus-dag`, `cortex-evm`) bound by a fourth append-only Merkle Mountain Range, the **Synaptic Field**.

## Layer Map

```
┌────────────────────────────────────────────────────────────┐
│  synapse-api (REST + WS + GraphQL)                         │
├────────────────────────────────────────────────────────────┤
│  thalamus-router · dhf-compositor · needlecast-router-svc  │
│  quellist-treasury-svc · bandwidth-faucet                  │
├────────────────────────────────────────────────────────────┤
│  4 sleeve runtimes  │  6 workers (BullMQ + NATS JetStream) │
├──────────────────┬──────────────────────┬──────────────────┤
│  medulla-pow     │  hippocampus-dag     │  cortex-evm      │
│  (Go PoW + MMR)  │  (Go DAG, ECCA CIDs) │  (geth + Clique) │
├──────────────────┴──────────────────────┴──────────────────┤
│  Postgres · Redis · NATS · MinIO · Prometheus/Grafana/Loki │
└────────────────────────────────────────────────────────────┘
```

## Quickstart

```bash
cp .env.example .env
pnpm install
pnpm build
docker compose up -d
pnpm contracts:deploy
pnpm demo
```

Open http://localhost:3030 (Grafana) for the **Coherence Overview** dashboard.

## What's in the box

- **24 Docker services** (`docker-compose.yml`) running the full stack laptop-first.
- **Five token contracts** (Compute, Memory, Sync, Routing, Residue) keyed by NFT `tokenId` not wallet, with on-chain Coherence Profile Vector + Epoch Binding Curve.
- **Two from-scratch Go chains** — `medulla-pow` (PoW + Synaptic Field MMR) and `hippocampus-dag` (epoch-tagged content-addressed DAG with token-gated retrieval).
- **One forkable EVM** — upstream geth with custom Clique PoA genesis (chain id 131072), pre-funded operator, deployable contract suite.
- **Saga-coordinated needlecast** — 6-step atomic re-sleeving with full rollback.
- **Coordination Residues** as first-class tradeable failure objects (5 kinds, first-valid-proof payout).
- **20 documents** under `docs/` — architecture, theory, API, runbook, security model, glossary.
- **K8s Helm scaffolding** (`deploy/k8s/`) and **Swarm overlay** (`docker-compose.distributed.yml`).

## Repo Layout

```
ecca-stack-v3/
├─ packages/                # shared TS libs (proto, crypto, bus, db, chain, service-base)
├─ services/                # long-running TS services
├─ workers/runner/          # 6-in-1 worker switched by WORKER_KIND
├─ contracts/               # Solidity 0.8.24 + Hardhat viem
├─ forks/
│  ├─ medulla-pow-go/       # PoW + Synaptic Field MMR (Go)
│  ├─ hippocampus-dag-go/   # epoch-tagged DAG (Go)
│  └─ cortex-evm-go/        # geth genesis + keystore
├─ deploy/
│  ├─ observability/        # prom + loki + grafana provisioning
│  └─ k8s/                  # 6 Helm charts + values-shared.yaml
├─ tests/integration/       # vitest E2E
├─ scripts/demo.ts          # end-to-end demo
└─ docs/                    # 20 documents
```

See [docs/architecture.md](docs/architecture.md) to start.

## License

Research-grade. Not for production use without a security review.
