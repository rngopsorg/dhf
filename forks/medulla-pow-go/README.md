# medulla-pow — Cortical Anchor Chain

Go-based PoW chain modeled on btcd, patched with ECCA-specific structures:

- **OP_COHERENCE_ROOT** (script opcode) — accepts a tuple `(crossRoot, evmRoot, ipfsRoot, sleevesRoot)` and validates it against the sender's last anchor.
- **Synaptic Field MMR** in the block header — a Merkle Mountain Range over the last 256 cross-chain coherence roots. Provides O(log n) inclusion proofs for any historical anchor without storing the full chain.
- **Difficulty retarget every 60 blocks** (~4-min epochs) instead of 2016.
- **Coherence-root binding**: a block is invalid unless its claimed `crossRoot` matches `sha256(evmRoot|btcRoot|ipfsRoot|sleevesRoot)`.

The chain produces *temporal-consistency proofs* for the ECCA cognitive system: mining is the production of these proofs, not arbitrary work. See [docs/synaptic_field_mmr.md](../../docs/synaptic_field_mmr.md).

## Build

```bash
docker build -t ecca/medulla-pow .
docker run --rm -p 8332:8332 ecca/medulla-pow
```

## RPC

`POST :8332/rpc` JSON-RPC 2.0 — methods: `getinfo`, `getepochanchor`, `getlatestanchor`, `submitcoherenceroot`, `getsynapticproof`, `joinpool`, `mineblock`.

`GET :8332/health` — liveness probe.
