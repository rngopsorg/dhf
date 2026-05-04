# Helm Charts

Six charts compose the distributed deployment:

| Chart | Releases |
|---|---|
| `chart-data` | postgres, redis, nats, minio |
| `chart-chains` | medulla-pow, hippocampus-dag, cortex-evm |
| `chart-orchestration` | synapse-api, thalamus-router, dhf-compositor, needlecast-router-svc, quellist-treasury-svc, bandwidth-faucet, contracts-deployer (one-shot Job) |
| `chart-sleeves` | sleeve-runtime-{human,ai,mining,memory} (Deployments with HPA) |
| `chart-workers` | 6 workers as Deployments |
| `chart-observability` | prometheus, grafana, loki, jaeger |

A shared `values.yaml` at `deploy/k8s/values-shared.yaml` carries chain ids, epoch interval, drift thresholds, and image tags. Each chart imports it via:

```yaml
# Chart.yaml
dependencies:
  - name: ecca-shared
    version: "3.0.0"
    repository: "file://../shared"
```

## Bootstrap

```bash
helm install ecca-data         deploy/k8s/chart-data         -f deploy/k8s/values-shared.yaml
helm install ecca-chains       deploy/k8s/chart-chains       -f deploy/k8s/values-shared.yaml
kubectl wait --for=condition=ready pod -l app=medulla-pow --timeout=120s
helm install ecca-orchestration deploy/k8s/chart-orchestration -f deploy/k8s/values-shared.yaml
# wait for contracts-deployer Job to complete:
kubectl wait --for=condition=complete job/contracts-deployer --timeout=180s
helm install ecca-workers       deploy/k8s/chart-workers       -f deploy/k8s/values-shared.yaml
helm install ecca-sleeves       deploy/k8s/chart-sleeves       -f deploy/k8s/values-shared.yaml
helm install ecca-observability deploy/k8s/chart-observability -f deploy/k8s/values-shared.yaml
```

The actual chart manifests are intentionally minimal in v3 — they reuse the same images built by docker-compose, only repackaged as `Deployment`/`StatefulSet` objects. See [deployment.md](../../docs/deployment.md).
