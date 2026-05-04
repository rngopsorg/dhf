# cortex-evm — Synaptic Stack

The Cortex EVM runs **upstream geth** (`ethereum/client-go`) with an ECCA-specific genesis. We do not maintain a hard fork of geth source for the v3 release; instead the patches described in `docs/chain_forks.md` (precompiles `isCoherent`, `verifyMerkleShard`, per-stack state-trie subtrees) are scheduled for v3.1 as a Go-Ethereum patch series.

For v3:
- **Clique PoA** with 4-second block time, single signer (the genesis operator).
- **Chain ID** 131072 (`0x20000`) — distinct from any mainnet/testnet id.
- **Genesis-funded operator** with PK `0xac0974…ff80` for the contracts-deployer one-shot. Replace in production deployments.
- The `cortex-evm` precompile addresses (`0x…1cea` for `isCoherent`, `0x…1ceb` for `verifyMerkleShard`) are reserved; until the patched binary ships, both calls are simulated by the `thalamus-router` service which mirrors the equivalent state on-chain via `EpochAnchor.commitAnchor()`.

## Files

- `genesis/genesis.json` — Clique PoA genesis with sealer extraData and pre-funded operator.
- `genesis/keystore/` — *generated at first boot* by the compose entrypoint.
- `genesis/password.txt` — empty unlock password for local development (do **not** use in production).
