# Playfair Terraform Setup

Declarative orchestration of the Playfair tripartite-game test on a local k3d cluster.

## What it manages

| Phase | Resource | Action |
|------|----------|--------|
| 1 | `null_resource.k3d_cluster` | Creates 1-server / 3-agent k3d cluster with port mappings |
| 1 | `null_resource.node_labels` | Labels agents `ecca.io/region=region-{storage,compute,bandwidth}` |
| 1 | `null_resource.namespaces` | Creates `ecca-shared` + 3 region namespaces |
| 2 | `null_resource.image_chain[*]` | Builds 3 Go chain images (medulla-pow, hippocampus-dag, cortex-evm) |
| 2 | `null_resource.image_ts_builder` | Builds the TS monorepo (ecca-builder + ecca-ts-builder stages) |
| 2 | `null_resource.image_service[*]` | Builds 7 service images + worker (off ts-builder stage) |
| 2 | `null_resource.image_orchestrator` | Builds the orchestrator image |
| 2 | `null_resource.k3d_image_import[*]` | Imports every image into the k3d cluster |
| 1.5 | `null_resource.latency` | Injects `tc` into k3d nodes + applies netem rules |
| 3 | `null_resource.shared_infra` | Postgres / Redis / NATS / MinIO + waits for ready |
| 4 | `null_resource.region_chains[*]` | 3 chain stacks per region + waits for ready |
| 5 | `null_resource.contracts_deployer` | One-shot job that deploys 7 contracts to cortex-evm |
| 6 | `null_resource.services` | siyana-api + thalamus-router per region + waits for ready |
| 7 | `null_resource.orchestrator` | Runs the tripartite-game job + collects results + renders HTML report |

Re-runs are driven by file-content hashes (via the `external` data source in `images.tf`):
edit a service → re-apply rebuilds **only that service** + re-imports + re-rolls deployments.

## Usage

```bash
cd tests/playfair/terraform
terraform init
terraform apply -auto-approve

# Iterate on services without rebuilding chains
terraform apply -var skip_images=true -var force_image_rebuild=$(date +%s)

# Run again with more epochs (only re-runs the orchestrator step)
terraform apply -var epochs=200

# Tear down the whole cluster
terraform destroy -auto-approve
```

## Variables

| Name | Default | Notes |
|------|---------|-------|
| `cluster_name` | `playfair` | k3d cluster name |
| `epochs` | `50` | Game epochs |
| `agents` | `3` | k3d agent count (must match `length(regions)`) |
| `regions` | `["region-storage", "region-compute", "region-bandwidth"]` | Applied to agents in order |
| `image_tag` | `local` | Tag for all `ecca-*` images |
| `port_map` | (4 entries) | Host:NodePort mappings (chosen to avoid Docker Desktop conflicts: 27070-27072 / 28332-28334 / 25001-25003 / 28545-28547) |
| `latency_*_ms` / `latency_*_jitter_ms` | 33/5, 42/8, 75/12 | Cross-region one-way latency profile (modeled on US-W2 / US-E1 / EU-W1) |
| `skip_images` | `false` | Skip docker builds (re-use locally-built images) |
| `skip_latency` | `false` | Skip tc netem injection |
| `skip_orchestrator` | `false` | Deploy infra only, don't run the game |
| `force_image_rebuild` | `""` | Bump this string to force a rebuild even when sources didn't change |
| `wait_timeout_seconds` | `240` | Per-rollout `kubectl rollout status` timeout |

## Outputs

```
$ terraform output
cluster_name = "playfair"
endpoints = {
  bandwidth = "http://localhost:27072"
  compute   = "http://localhost:27071"
  storage   = "http://localhost:27070"
}
latency_profile = "storage↔compute 33±5ms, compute↔bandwidth 42±8ms, storage↔bandwidth 75±12ms"
regions = ["region-storage", "region-compute", "region-bandwidth"]
report_path = ".../tests/playfair/playfair-report.html"
results_dir = ".../tests/playfair/results"
teardown = "terraform destroy -auto-approve  # tears down cluster + state"
```

## Architecture notes

* **No third-party providers.** Only `null`, `local`, `external` from HashiCorp. Avoids
  `kubernetes` provider auth headaches with k3d and `kubectl_manifest` provider compatibility issues.
* **Idempotency** comes from `kubectl apply -f` + `rollout status` + per-job `delete --ignore-not-found`.
* **`tc` injection** is the trickiest piece: k3d agents run a stripped k3s image with no package
  manager and no libc. `inject-tc.sh` extracts the static `tc` binary, `ld-musl`, and 6 shared libs
  (resolved via `readlink -f` for actual sonames) from a transient Alpine container, then `docker cp`s
  them into each agent. Works on both arm64 (Apple Silicon) and amd64.
* **Image rebuild triggers** use `data.external.src_hashes` which hashes service/chain/orchestrator
  source trees. Editing `services/siyana-api/src/server.ts` invalidates only the ts-builder hash and
  re-runs only the affected `image_service[*]` resources.

## Prerequisites

```bash
brew install k3d terraform kubectl helm
# Docker Desktop running
```
