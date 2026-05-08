# Deployment

## Local (laptop)

```bash
cp .env.example .env
pnpm install
pnpm build
docker compose up -d
pnpm contracts:deploy
pnpm demo
```

Default ports:

| Service | Port |
|---|---|
| siyana-api | 7070 |
| needlecast-router-svc | 7071 |
| thalamus-router | 7072 |
| dhf-compositor | 7073 |
| quellist-treasury-svc | 7074 |
| bandwidth-faucet | 7075 |
| medulla-pow RPC | 8332 |
| hippocampus-dag API | 5001 |
| cortex-evm RPC | 8545 |
| Grafana | 3030 |
| Jaeger | 16686 |

## Distributed (Docker Swarm)

```bash
docker stack deploy -c docker-compose.yml -c docker-compose.distributed.yml ecca
```

Use `deploy.placement.constraints` to pin chains to dedicated nodes:

```yaml
medulla-pow:
  deploy:
    placement:
      constraints: [node.labels.role==chain]
```

## Kubernetes

Helm charts under `deploy/k8s/`:

```bash
helm install ecca-data deploy/k8s/chart-data
helm install ecca-chains deploy/k8s/chart-chains
helm install ecca-orchestration deploy/k8s/chart-orchestration
helm install ecca-sleeves deploy/k8s/chart-sleeves
helm install ecca-workers deploy/k8s/chart-workers
helm install ecca-observability deploy/k8s/chart-observability
```

The charts share a `values-shared.yaml` for cross-chart configuration (epoch interval, drift thresholds, token defaults).

## Health Checks

Every service exposes `/healthz` (process up) and `/readyz` (dependencies reachable). Compose uses `healthcheck:` blocks against `/healthz`; K8s uses `livenessProbe`/`readinessProbe`.

See [runbook.md](runbook.md).
