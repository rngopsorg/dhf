# ECCA Stack v3 — Build & Implementation Guide for Copilot Agents

> This document describes the current state, what's broken, what's missing, and how to bring the full system to a buildable + testable state.

---

## Table of Contents

1. [Current State Summary](#current-state-summary)
2. [Critical Fixes Required Before Build](#critical-fixes-required-before-build)
3. [Dependency Graph (Build Order)](#dependency-graph-build-order)
4. [Phase 1 — Fix Shared Packages (must be serial)](#phase-1--fix-shared-packages)
5. [Phase 2 — Fix Services & Workers (parallelizable)](#phase-2--fix-services--workers)
6. [Phase 3 — Go Fork Builds (fully parallel)](#phase-3--go-fork-builds)
7. [Phase 4 — Contracts Compilation (parallel with Phase 3)](#phase-4--contracts-compilation)
8. [Phase 5 — Integration Test + Docker Compose (serial, after all above)](#phase-5--integration-test--docker-compose)
9. [Phase 6 — Polish & Extended Tests](#phase-6--polish--extended-tests)
10. [Testing Matrix](#testing-matrix)

---

## Current State Summary

### What EXISTS and is structurally complete:
- ✅ Root monorepo config (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `Makefile`)
- ✅ Docker Compose (24 services, YAML anchors, networking, volume mounts)
- ✅ `packages/proto` — tokens, events, constants (minor export issues)
- ✅ `packages/crypto` — all crypto primitives (sha256, HKDF, AES-GCM, ed25519, Merkle, MMR, CID)
- ✅ `packages/bus` — NATS JetStream wrapper (`AxonalBus` + `getBus()`)
- ✅ `packages/db` — Prisma schema + `getDb()` singleton
- ✅ `packages/chain` — viem cortex chain + `HippocampusClient` + `MedullaClient`
- ✅ `packages/service-base` — Fastify bootstrap helpers
- ✅ `services/siyana-api` — full REST + WS server (has type errors)
- ✅ `services/thalamus-router` — epoch tick + coherence folding (has type errors)
- ✅ `services/dhf-compositor` — DAG walk + decrypt (has type errors)
- ✅ `services/needlecast-router-svc` — saga (has type errors)
- ✅ `services/quellist-treasury-svc` — emission service (has type errors)
- ✅ `services/bandwidth-faucet` — rate-limited faucet (has type errors)
- ✅ `services/sleeve-runtime` — 4-in-1 parametric sleeve
- ✅ `workers/runner` — 6-in-1 worker dispatcher (has type errors)
- ✅ `contracts/` — 7 Solidity contracts + Hardhat config + deploy script
- ✅ `forks/medulla-pow-go/` — complete Go PoW chain (mmr + chain + rpc + main + Dockerfile)
- ✅ `forks/hippocampus-dag-go/` — complete Go DAG (dag + http + Dockerfile)
- ✅ `forks/cortex-evm-go/` — genesis.json + password.txt (geth image, no custom code)
- ✅ `deploy/observability/` — prometheus.yml, loki.yml, grafana provisioning
- ✅ `deploy/k8s/` — Helm chart stubs + values-shared.yaml
- ✅ `docs/` — 20 documentation files
- ✅ `tests/integration/` — vitest E2E scaffold

### What will NOT compile as-is (Type Errors):
The services/workers use Prisma fields that don't exist in the schema, import non-existent named exports from `@ecca/proto`, and pass wrong argument types to `@ecca/crypto` functions.

---

## Critical Fixes Required Before Build

### FIX-1: Prisma Schema — Field Mismatches (BLOCKING)

The services write to Prisma models using fields that don't exist in the schema. The schema must be updated to match.

**Current `Anchor` model** has: `merkleRoot, signature, fromSleeve, toSleeve, txHash, evmTxHash`
**Services expect**: `height, blockHash, crossRoot, evmRoot, ipfsRoot, sleevesRoot, synapticFieldRoot, ts`

**Current `Residue` model** has: `evidence (Json), resolverStack, proofTxHash`
**Services expect**: `sleeveId, status, payoutEst, detectedAt` (some exist, `sleeveId` and `payoutEst` as floats don't)

**Current `Epoch` model** has: `blockHash, difficulty`
**Services expect**: `medullaHeight (BigInt), anchorBlockHash`

**Current `AuditLog` model** has: `actor, action, target, payload`
**Services expect**: `stackId, epoch, action, detail (Json), ts`

**Action:** Rewrite `packages/db/prisma/schema.prisma` to match the service API. See [Phase 1 task P1-A](#p1-a-fix-prisma-schema).

---

### FIX-2: Proto Export Mismatches (BLOCKING)

| Import used in services/workers | Actual export in `@ecca/proto` | Fix needed |
|---|---|---|
| `import { EPOCH_INTERVAL_MS } from '@ecca/proto'` | Only exists as `ECCA.EPOCH_INTERVAL_MS` | Add standalone re-export |
| `import { DRIFT_MAX_DEFAULT } from '@ecca/proto'` | Only exists as `ECCA.DRIFT_MAX_DEFAULT` | Add standalone re-export |
| `import { ResidueKind } from '@ecca/proto'` | Exists as zod enum, but used as `ResidueKind.StaleOrdering` (object property) | Zod enums work as `ResidueKind.enum.StaleOrdering` — either update usage or add a plain enum |
| `import { type EmbodimentType } from '@ecca/proto'` | Exported from events.ts as zod type | ✅ Works |
| `import { DEFAULT_BALANCE } from '@ecca/proto'` | Exported from tokens.ts | ✅ Works |

**Action:** Add convenience re-exports in `packages/proto/src/index.ts`. See [Phase 1 task P1-B](#p1-b-fix-proto-exports).

---

### FIX-3: Crypto Type Mismatches

| Caller code | Actual signature | Issue |
|---|---|---|
| `thalamus-router`: `coherenceRoot({ evm: evmRoot, btc: ..., ipfs: ..., sleeves: ... })` where `evmRoot` is `Uint8Array` | `coherenceRoot(parts: { evm: string, btc: string, ipfs: string, sleeves: string })` — takes hex **strings** | Caller must convert `Uint8Array → hex` before passing |
| `thalamus-router`: `merkleRoot(evmHashes.map(h => Buffer.from(h, 'hex')))` | `merkleRoot(leaves: Array<Uint8Array \| string>): string` | ✅ Works (accepts Uint8Array) |
| `siyana-api`: `genIdentityKeypair()` | Returns `{ pub: string, priv: string }` (hex) | ✅ Works |
| `siyana-api`: `encrypt(body.text, k)` where k = `epochKey(...)` returns `Uint8Array` | `encrypt(plaintext: string, key: Uint8Array): EncPayload` | ✅ Works |

**Action:** Fix `thalamus-router` to hex-encode before passing to `coherenceRoot`. See [Phase 2 fixes](#phase-2--fix-services--workers).

---

### FIX-4: Docker-Compose → Source Alignment

All compose service commands already point to `dist/server.js` and each service's entry is `src/server.ts` → `dist/server.js`. ✅ No fix needed.

---

## Dependency Graph (Build Order)

```
Layer 0 (leaf packages — no internal deps):
  packages/proto

Layer 1 (depends on proto):
  packages/crypto
  packages/bus

Layer 2 (depends on crypto + bus + proto):
  packages/db        (only proto for types)
  packages/chain     (proto + crypto)
  packages/service-base (proto + bus)

Layer 3 (depends on all packages):
  services/siyana-api
  services/thalamus-router
  services/dhf-compositor
  services/needlecast-router-svc
  services/quellist-treasury-svc
  services/bandwidth-faucet
  services/sleeve-runtime
  workers/runner

Layer 4 (depends on packages/chain):
  contracts/

Layer INDEPENDENT (Go, no TS deps):
  forks/medulla-pow-go/
  forks/hippocampus-dag-go/
  forks/cortex-evm-go/    (just genesis files, uses upstream geth image)
```

**Turbo already encodes this**: `"build": { "dependsOn": ["^build"] }` — so `pnpm build` (via turborepo) will automatically respect the order.

---

## Phase 1 — Fix Shared Packages

> **MUST be done first, serially in order.** All services depend on these.

### P1-A: Fix Prisma Schema

**File:** `packages/db/prisma/schema.prisma`

Replace the schema with one that matches service usage. Required changes:

```prisma
model Anchor {
  id                 Int      @id @default(autoincrement())
  stackId            String?
  epoch              Int
  height             BigInt   @default(0)
  blockHash          String?
  crossRoot          String?
  evmRoot            String?
  ipfsRoot           String?
  sleevesRoot        String?
  synapticFieldRoot  String?
  ts                 DateTime @default(now())
  stack              Stack?   @relation(fields: [stackId], references: [id])
  @@index([epoch])
  @@index([stackId])
}

model Residue {
  id           String   @id
  kind         String                  // ResidueKind
  stackId      String?
  sleeveId     String?
  status       String   @default("open") // open | claimed | resolved
  payoutEst    Float    @default(0)
  payout       Float?
  evidence     Json?
  resolverStack String?
  proofTxHash  String?
  detectedAt   DateTime @default(now())
  resolvedAt   DateTime?
  @@index([status])
  @@index([kind])
}

model Epoch {
  number            Int      @id
  crossRoot         String?
  evmRoot           String?
  ipfsRoot          String?
  sleevesRoot       String?
  blockHash         String?
  anchorBlockHash   String?
  medullaHeight     BigInt   @default(0)
  difficulty        Int?
  ts                DateTime @default(now())
}

model AuditLog {
  id           Int      @id @default(autoincrement())
  stackId      String?
  actor        String?
  epoch        Int?
  action       String
  target       String?
  detail       Json?
  payload      Json?              // legacy compat
  ts           DateTime @default(now())
  @@index([ts])
  @@index([stackId])
  @@index([action])
}
```

**Then run:** `cd packages/db && npx prisma generate`

**Verification:** `npx prisma validate`

---

### P1-B: Fix Proto Exports

**File:** `packages/proto/src/index.ts`

Add standalone re-exports for constants used by services:

```typescript
// Convenience re-exports (services import these by name)
export const EPOCH_INTERVAL_MS = ECCA.EPOCH_INTERVAL_MS;
export const DRIFT_MAX_DEFAULT = ECCA.DRIFT_MAX_DEFAULT;
export const FIDELITY_MIN_DEFAULT = ECCA.FIDELITY_MIN_DEFAULT;
export const CORTEX_CHAIN_ID = ECCA.CORTEX_CHAIN_ID;
export const SYNAPTIC_FIELD_DEPTH = ECCA.SYNAPTIC_FIELD_DEPTH;
```

**File:** `packages/proto/src/events.ts`

The `ResidueKind` is a Zod enum. Services use it as `ResidueKind.StaleOrdering` (like a regular enum). Fix: either change services to `ResidueKind.enum.StaleOrdering` OR add a companion plain object:

```typescript
// Plain enum companion for non-zod consumers
export const ResidueKindEnum = {
  StaleOrdering: 'stale-ordering',
  SpeculativeDivergence: 'speculative-divergence',
  HistoricalNonCanonical: 'historical-non-canonical',
  ReorgOrphan: 'reorg-orphan',
  ShardLoss: 'shard-loss',
} as const;
```

Then update `workers/runner/src/server.ts` to use `ResidueKindEnum.StaleOrdering` or the enum literal strings directly.

**Verification:** `cd packages/proto && pnpm build` should complete with no errors.

---

### P1-C: Verify packages/crypto builds

**File:** `packages/crypto/src/index.ts` — should be fine as-is.

**Verification:** `cd packages/crypto && pnpm build`

---

### P1-D: Verify packages/bus builds

**File:** `packages/bus/src/index.ts` — should be fine (depends on `@ecca/proto` for types).

**Verification:** `cd packages/bus && pnpm build`

---

### P1-E: Verify packages/chain builds

**File:** `packages/chain/src/` — depends on `@ecca/proto` + `@ecca/crypto`. Verify `HippocampusClient` and `MedullaClient` compile.

**Verification:** `cd packages/chain && pnpm build`

---

### P1-F: Verify packages/service-base builds

**Verification:** `cd packages/service-base && pnpm build`

---

**Phase 1 Total:** Fix 2 files, then run `pnpm --filter '@ecca/proto' --filter '@ecca/crypto' --filter '@ecca/bus' --filter '@ecca/db' --filter '@ecca/chain' --filter '@ecca/service-base' build`

---

## Phase 2 — Fix Services & Workers

> **Can be done in parallel** (each service is independent). Only depends on Phase 1 completing.

### P2-A: Fix `services/thalamus-router/src/server.ts`

**Issues:**
1. `coherenceRoot()` takes `{ evm: string, btc: string, ipfs: string, sleeves: string }` — all hex strings. But the caller passes `Uint8Array`. Fix: convert with `bytesToHex()`.
2. `merkleRoot()` returns `string` (hex). The code assigns it to vars then passes to `coherenceRoot` — that's fine once item 1 is fixed.
3. `db.epoch.upsert` uses fields `medullaHeight`, `anchorBlockHash` which must exist in schema (fixed by P1-A).

**Specific fix:**
```typescript
import { merkleRoot, sha256, sha256hex, coherenceRoot, bytesToHex } from '@ecca/crypto';
// ...
const evmRootHex = evmHashes.length ? merkleRoot(evmHashes.map(h => h)) : bytesToHex(new Uint8Array(32));
const ipfsRootHex = ipfsHashes.length ? merkleRoot(ipfsHashes.map(h => h)) : bytesToHex(new Uint8Array(32));
const sleevesRootHex = sleeveHashes.length ? merkleRoot(sleeveHashes.map(h => h)) : bytesToHex(new Uint8Array(32));
const cross = coherenceRoot({ evm: evmRootHex, btc: bytesToHex(new Uint8Array(32)), ipfs: ipfsRootHex, sleeves: sleevesRootHex });
```
(`merkleRoot` already returns hex strings; `coherenceRoot` takes hex strings; the `hex32()` helper can be removed.)

---

### P2-B: Fix `services/siyana-api/src/server.ts`

**Issues:**
1. `import { type EmbodimentType } from '@ecca/proto'` — unused, can remove.
2. `getBus()` is async but used correctly (awaited at top).
3. Prisma calls use the new schema fields — dependent on P1-A.
4. `genIdentityKeypair()` — name must match export. Currently exported as `genIdentityKeypair`. ✅

**Verification:** Should compile cleanly after P1-A and P1-B.

---

### P2-C: Fix `services/dhf-compositor/src/server.ts`

**Issues:**
1. `decrypt(frag.ciphertext as any, k)` — `decrypt` takes `EncPayload` + `Uint8Array`. The `as any` cast works but should be typed.
2. Depends on P1-A for `db.stack.findUnique`.

---

### P2-D: Fix `services/needlecast-router-svc/src/server.ts`

**Issues:**
1. Unused imports (`encrypt, decrypt, epochKey, merkleRoot`) — remove or these just bloat, not errors.
2. Schema-dependent (`db.sleeve.update`).

---

### P2-E: Fix `services/quellist-treasury-svc/src/server.ts`

**Issues:**
1. `effectiveBalance` takes `(raw: TokenBalance, cpv: CPV, curve: EBC, epochDelta: number)` and returns `TokenBalance`. The call site already matches after the earlier fix we applied.
2. Prisma `AuditLog.create` uses `detail` field — requires P1-A.

---

### P2-F: Fix `services/bandwidth-faucet/src/server.ts`

Likely works as-is after P1-A. Minimal dependencies.

---

### P2-G: Fix `services/sleeve-runtime/src/server.ts`

1. Uses `fetch()` to call siyana-api — no internal package deps beyond `@ecca/service-base` and `@ecca/bus`.
2. `getBus()` is called but not used (only `bus` in shutdown). Either remove or keep for event publishing.

---

### P2-H: Fix `workers/runner/src/server.ts`

**Issues:**
1. `import { ResidueKind, DRIFT_MAX_DEFAULT } from '@ecca/proto'` — fix per P1-B.
2. `ResidueKind.SpeculativeDivergence` → use the enum companion or literal `'speculative-divergence'`.
3. `db.residue.create` uses `sleeveId` field — requires P1-A.
4. `db.auditLog.create` uses `stackId`, `epoch`, `detail` fields — requires P1-A.
5. `db.anchor.create` uses expanded anchor fields — requires P1-A.

---

### Parallel Execution Plan for Phase 2

```
After Phase 1 completes:
  ┌── P2-A (thalamus)     ─┐
  ├── P2-B (siyana-api)   │
  ├── P2-C (compositor)    │
  ├── P2-D (needlecast)    ├── ALL PARALLEL
  ├── P2-E (treasury)      │
  ├── P2-F (faucet)        │
  ├── P2-G (sleeve)        │
  └── P2-H (worker-runner) ─┘
```

**Verification per service:** `cd services/<name> && pnpm build` (or `cd workers/runner && pnpm build`)

**Full verification:** `pnpm build` (runs all via turborepo in dependency order)

---

## Phase 3 — Go Fork Builds

> **Fully parallel with Phase 2.** No TypeScript dependencies.

### P3-A: Build `forks/medulla-pow-go`

```bash
cd forks/medulla-pow-go
go build ./...
go vet ./...
# Optionally add unit tests
go test ./...
docker build -t ecca-medulla-pow .
```

**Missing/TODO:**
- No `go.sum` file (run `go mod tidy` to generate)
- The `chain.go` file uses only stdlib (`crypto/sha256`, `encoding/binary`, `math/big`, `sync`). Should build fine with no deps.
- Add **unit tests** for `internal/mmr/mmr_test.go` (test append, root, merge, window rollover)
- Add **unit tests** for `internal/chain/chain_test.go` (test genesis, mining, epoch increment, retarget)
- Add **basic integration test** for the RPC server (spin up, submit coherence root, getinfo)

---

### P3-B: Build `forks/hippocampus-dag-go`

```bash
cd forks/hippocampus-dag-go
go build ./...
go vet ./...
go test ./...
docker build -t ecca-hippocampus-dag .
```

**Missing/TODO:**
- No `go.sum` (run `go mod tidy`)
- Add **unit tests** for `internal/dag/dag_test.go` (put, get, pin, recall with epoch gate, recall with depth gate, fidelity calc)
- Add **API integration test** (HTTP test against the handler)

---

### P3-C: cortex-evm (no build — uses upstream geth image)

The compose service uses `ethereum/client-go:v1.14.8` directly. Just verify:
- `genesis.json` is valid JSON and passes `geth init`
- The init/run entrypoint script exists and is correct

**Missing:** The docker-compose `cortex-evm` service mounts an init script. Check that the compose entrypoint actually exists:

```yaml
cortex-evm:
  image: ethereum/client-go:v1.14.8
  volumes:
    - ./forks/cortex-evm-go/genesis:/genesis:ro
  entrypoint: ["/bin/sh", "-c"]
  command: ["geth init /genesis/genesis.json --datadir /data && geth --datadir /data --networkid 131072 ..."]
```

**TODO:** Create `forks/cortex-evm-go/scripts/init-and-run.sh` that:
1. Runs `geth init /genesis/genesis.json --datadir /data` if not already initialized
2. Starts geth with `--networkid 131072 --http --http.addr 0.0.0.0 --http.api eth,net,web3,clique --http.vhosts '*' --mine --miner.etherbase 0x...0ECC --unlock 0xf39F...2266 --password /genesis/password.txt --allow-insecure-unlock --nodiscover`

---

## Phase 4 — Contracts Compilation

> **Parallel with Phase 3, after Phase 1 (needs `@ecca/chain` and `@ecca/proto`).**

```bash
cd contracts
npx hardhat compile
npx hardhat test     # if any tests exist
```

**Missing/TODO:**
- No contract tests exist. Create `contracts/test/` with at minimum:
  - `StackIdentity.test.ts` — mint, authorize, recordNeedlecast
  - `BandwidthToken.test.ts` — mint, spend, sleeveAuthorized, transferStack
  - `QuellistTreasury.test.ts` — issue, claimEpochRewards
  - `ResidueRegistry.test.ts` — detect, submitProof (mints ResidueToken)
- The `contracts/Dockerfile` already handles the one-shot deploy; verify it works.

---

## Phase 5 — Integration Test + Docker Compose

> **Serial. Must wait for Phases 1-4.**

### P5-A: Verify full `pnpm build` succeeds

```bash
pnpm install
pnpm build
```

Should exit 0 with all packages compiled.

---

### P5-B: Docker Compose smoke test

```bash
cp .env.example .env
docker compose build
docker compose up -d
# Wait for health checks
docker compose ps
curl http://localhost:8332/health      # medulla-pow
curl http://localhost:5001/health      # hippocampus-dag
curl http://localhost:7070/healthz     # siyana-api
```

---

### P5-C: Run contracts deploy

```bash
pnpm contracts:deploy
# Verify deployments/cortex.json is written
```

---

### P5-D: Run integration tests

```bash
pnpm test
# or: cd tests && pnpm test
```

---

### P5-E: Run demo script

```bash
pnpm demo
# Should create stack, spawn sleeves, perceive, recall, needlecast, and print results
```

---

## Phase 6 — Polish & Extended Tests

> **Parallel tasks, can be delegated independently.**

### P6-A: Go unit tests

Create test files:
- `forks/medulla-pow-go/internal/mmr/mmr_test.go`
- `forks/medulla-pow-go/internal/chain/chain_test.go`
- `forks/medulla-pow-go/internal/rpc/rpc_test.go`
- `forks/hippocampus-dag-go/internal/dag/dag_test.go`
- `forks/hippocampus-dag-go/cmd/hippod/main_test.go`

### P6-B: Solidity unit tests

Create test files under `contracts/test/`:
- Hardhat + viem tests for each contract
- Cover: minting, spending, authorization, epoch advancement, residue lifecycle

### P6-C: Load tests

Create `tests/load/` with k6 scripts:
- `perceive-load.js` — ramp 100 concurrent perceive calls
- `recall-load.js` — measure fidelity under load
- `needlecast-load.js` — concurrent transfer sagas

### P6-D: Compat runner

Implement `compat-runner/src/run.ts` that:
1. Reads v2 test vectors from `../ecca-stack/` (the v2 simulation)
2. Replays each against siyana-api
3. Validates structural equivalence

### P6-E: CI pipeline

Create `.github/workflows/ci.yml`:
```yaml
jobs:
  build-ts:
    - pnpm install
    - pnpm build
    - pnpm test
  build-go:
    - cd forks/medulla-pow-go && go test ./...
    - cd forks/hippocampus-dag-go && go test ./...
  build-contracts:
    - cd contracts && npx hardhat compile && npx hardhat test
  integration:
    needs: [build-ts, build-go, build-contracts]
    services: [postgres, redis, nats]
    - docker compose up -d
    - pnpm contracts:deploy
    - pnpm test
```

### P6-F: Helm chart manifests

Complete the Helm templates for `chart-data`, `chart-orchestration`, `chart-sleeves`, `chart-workers`, `chart-observability` (currently only `chart-chains` has templates).

---

## Testing Matrix

| Layer | Tool | What to test | Priority |
|---|---|---|---|
| Go forks | `go test` | MMR append/root, chain mining/retarget, RPC methods, DAG put/get/recall/epoch-gate | HIGH |
| Solidity | Hardhat + viem | Token mint/spend, NFT ownership, residue lifecycle, treasury emission | HIGH |
| TS packages | vitest (unit) | `effectiveBalance()`, `coherenceRoot()`, `merkleRoot()`, `epochKey()` round-trips | MEDIUM |
| Services | vitest (integration) | Full compose smoke: create→perceive→recall→needlecast→epoch→residue | HIGH |
| Load | k6 | 100 concurrent perceives, 50 concurrent recalls | LOW (polish) |
| Compat | vitest | v2 vector replay | LOW (polish) |

---

## Quick Reference: File Paths to Edit

| Task | File(s) |
|---|---|
| Fix Prisma schema | `packages/db/prisma/schema.prisma` |
| Fix proto exports | `packages/proto/src/index.ts`, `packages/proto/src/events.ts` |
| Fix thalamus types | `services/thalamus-router/src/server.ts` |
| Fix worker imports | `workers/runner/src/server.ts` |
| Create geth init script | `forks/cortex-evm-go/scripts/init-and-run.sh` |
| Add Go tests | `forks/*/internal/*/…_test.go` |
| Add Solidity tests | `contracts/test/*.test.ts` |
| Add CI | `.github/workflows/ci.yml` |

---

## Environment Requirements

- **Node.js** ≥ 20.10
- **pnpm** 9.7.0+
- **Go** 1.22+
- **Docker** with Compose v2
- **Hardhat** (via npx, installed by `pnpm install`)

---

## Parallel Work Assignment (for multiple agents)

```
Agent A: Phase 1 (P1-A through P1-F) → then P2-A, P2-B, P2-H
Agent B: Phase 3 (P3-A, P3-B, P3-C) — all Go work, zero TS dependency
Agent C: Phase 4 (contracts) — can start immediately on Solidity tests
Agent D: Phase 2 (P2-C through P2-G) — after Phase 1 signals done
Agent E: Phase 6 (P6-E CI, P6-F Helm) — infra/config, no code deps
```

After all agents complete: one agent runs Phase 5 (integration + compose smoke test).

---

## Success Criteria

1. `pnpm build` exits 0 (all TS packages + services compile)
2. `go build ./...` in both Go forks exits 0
3. `npx hardhat compile` in contracts/ exits 0
4. `docker compose up -d` brings all 24 services to healthy
5. `pnpm demo` completes the full coherence cycle (create → perceive → recall → needlecast → epoch → residue)
6. `pnpm test` passes integration tests
7. Go test suites pass with ≥ 80% coverage on core logic (mmr, chain, dag)
8. Solidity tests pass covering token mechanics and residue lifecycle
