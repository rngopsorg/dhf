# API Reference

Base URL: `http://localhost:7070`. All endpoints return JSON. Errors carry `{ error: string, detail?: string }` with HTTP status.

## Stacks

```http
POST /v1/stacks                       { name, kind } → Stack + identityPriv
GET  /v1/stacks                       → Stack[]
GET  /v1/stacks/:id                   → Stack { sleeves, anchors }
POST /v1/stacks/:id/remember          { text, pin? } → { cid }
GET  /v1/stacks/:id/recall?depth=&memoryToken=  → RecallResponse
```

## Sleeves

```http
POST   /v1/sleeves                    { stackId, embodimentType, hostname? } → Sleeve
GET    /v1/sleeves                    → Sleeve[]
DELETE /v1/sleeves/:id                → { ok }
POST   /v1/sleeves/:id/perceive       { input } → { cid, thought }
POST   /v1/sleeves/:id/sync           → { ok, epoch }
```

## Needlecast

```http
POST /v1/needlecast                   { from, to } → { ok, sagaId, route, shards }
```

## Epochs / Mining

```http
GET  /v1/epochs/current               → { epoch, height, tip }
POST /v1/mining/block                 → AnchorBlock
```

## Coordination

```http
GET  /v1/coordination/desync          → DriftySleeve[]
GET  /v1/coordination/residues        → Residue[]
```

## Tokens / Treasury

```http
GET  /v1/tokens/balances/:stackId     → { stackId, sleeveTotals }
GET  /v1/treasury/issuance/:stackId   → AuditLog[]    (host: quellist-treasury-svc:7074)
POST /v1/treasury/claim               { stackId } → { stackId, claimable }
POST /v1/faucet/drip                  { stackId } → { ok, granted, sleeves }    (host: bandwidth-faucet:7075)
```

## WebSocket

```
GET ws://localhost:7070/ws            ← all bus events as JSON lines
```

## Direct Chain RPCs

- **medulla-pow**: `POST http://medulla-pow:8332/rpc` — JSON-RPC 2.0 (`getinfo`, `getlatestanchor`, `getepochanchor`, `submitcoherenceroot`, `getsynapticproof`, `joinpool`, `mineblock`)
- **hippocampus-dag**: `POST http://hippocampus-dag:5001/dag/put`, `GET /dag/get?cid=`, `POST /pin/add?cid=`, `POST /dhf/recall`
- **cortex-evm**: standard JSON-RPC at `:8545` (chainId 131072)

See [runbook.md](runbook.md).
