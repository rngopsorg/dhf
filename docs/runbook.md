# Runbook

## Fresh Boot

```bash
docker compose up -d cortical-registry-db working-memory-cache axonal-bus shard-vault
docker compose up -d medulla-pow hippocampus-dag cortex-evm
docker compose up -d contracts-deployer       # one-shot
docker compose up -d                          # everything else
```

Wait for `synapse-api/healthz` to return 200 before issuing requests.

## Smoke Test

```bash
curl -X POST http://localhost:7070/v1/stacks -H 'content-type: application/json' \
  -d '{"name":"ops-test","kind":"human"}'
# capture id (e.g. stack:human:1:abc123)

curl -X POST http://localhost:7070/v1/sleeves -H 'content-type: application/json' \
  -d '{"stackId":"<id>","embodimentType":"ai"}'

curl -X POST http://localhost:7070/v1/sleeves/<sleeve-id>/perceive \
  -H 'content-type: application/json' -d '{"input":"hello cortex"}'

curl 'http://localhost:7070/v1/stacks/<id>/recall?depth=4'
```

## Common Incidents

### Epochs stop advancing

```bash
docker compose logs --tail=200 thalamus-router | grep -i epoch
docker compose logs --tail=200 medulla-pow | tail
curl -X POST http://localhost:7072/v1/epoch/tick    # force one
```

If medulla itself is wedged: `docker compose restart medulla-pow`. The MMR rebuilds from scratch on cold start (research-grade simulation).

### Hippocampus 404s on known CIDs

```bash
docker compose logs --tail=200 hippocampus-dag | grep "epoch_drift"
# if drift > 2 and CID not pinned → pin it manually
curl -X POST 'http://localhost:5001/pin/add?cid=ecca://...'
```

A `memory-reconciler-worker` runs this automatically each epoch; failure to recover indicates the CID is genuinely lost (residue `shard-loss` opens; bounty available).

### Drift Storm

Many sleeves at `drift > 30`:

```bash
curl 'http://localhost:7070/v1/coordination/desync'
```

If this is many sleeves at once, the *epoch tick is wedged*; treat as "epochs stop advancing".

### Reorg

```bash
curl 'http://localhost:7070/v1/coordination/residues' | jq '.[] | select(.kind=="reorg-orphan")'
```

Resolution is automatic by the `epoch-anchor-worker` on the next anchor.

## Backup / Restore

- **Postgres**: `pg_dump -U ecca ecca > ecca-$(date +%F).sql`
- **MinIO**: `mc mirror minio/ecca-shards ./backup/shards`
- **medulla-pow**: stateless rebuild from RPC tip exists in v3.1; v3 has no on-disk state by design.
- **hippocampus-dag**: in-memory by default; for durability, run with `MINIO_ENDPOINT` env set so the blockstore mirrors to MinIO.

See [security_model.md](security_model.md), [deployment.md](deployment.md).
