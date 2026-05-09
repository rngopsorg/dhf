// Thalamus Router — cross-shard event arbiter.
// Subscribes to all chain events, computes the per-epoch crossRoot, and
// submits it to medulla-pow. Then bridges the anchor to the EpochAnchor
// contract on cortex-evm so the coherence chain is verifiable on-chain.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import { getDb } from '@ecca/db';
import { merkleRoot, sha256hex, coherenceRoot, bytesToHex } from '@ecca/crypto';
import { MedullaClient, cortexPublic, cortexWallet, EPOCH_ANCHOR_ABI } from '@ecca/chain';
import { EPOCH_INTERVAL_MS } from '@ecca/proto';
import { type Hex, toHex, keccak256 } from 'viem';

const PORT = Number(process.env.THALAMUS_PORT ?? 7072);
const OPERATOR_PK = (process.env.OPERATOR_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
const EPOCH_ANCHOR_ADDR = process.env.EPOCH_ANCHOR_ADDRESS as Hex | undefined;

async function main() {
  const app = await createService({ name: 'thalamus-router' });
  const log = app.log;
  const region = (process.env.ECCA_REGION ?? 'default').replace(/[^a-z0-9]/g, '-');
  const bus = await getBus();
  const db = getDb();
  const medulla = new MedullaClient();

  // Cortex EVM clients for bridging anchors on-chain.
  const cortex = cortexPublic();
  const wallet = cortexWallet(OPERATOR_PK);

  // Buffered event hashes per epoch — drained at each epoch tick.
  let currentEpoch = 0;
  const evmHashes: string[] = [];
  const ipfsHashes: string[] = [];
  const sleeveHashes: string[] = [];

  // Aggregate hippocampus + EVM + sleeve events.
  await bus.subscribe('ecca.memory.>', `thalamus-mem-${region}`, async (ev: any) => {
    if (ev?.cid) ipfsHashes.push(sha256hex(ev.cid));
  });
  await bus.subscribe('ecca.sleeve.>', `thalamus-sleeve-${region}`, async (ev: any) => {
    sleeveHashes.push(sha256hex(JSON.stringify({ t: ev.type, id: ev.sleeveId ?? ev.stackId })));
  });
  await bus.subscribe('ecca.chain.evm.>', `thalamus-evm-${region}`, async (ev: any) => {
    if (ev?.txHash) evmHashes.push(ev.txHash);
  });

  // Epoch tick — every EPOCH_INTERVAL_MS, fold buffers into a coherence root,
  // submit to medulla-pow, and bridge the anchor to cortex-evm EpochAnchor.
  async function tick() {
    try {
      const evmRootHex = evmHashes.length ? merkleRoot(evmHashes) : '0'.repeat(64);
      const ipfsRootHex = ipfsHashes.length ? merkleRoot(ipfsHashes) : '0'.repeat(64);
      const sleevesRootHex = sleeveHashes.length ? merkleRoot(sleeveHashes) : '0'.repeat(64);
      const cross = coherenceRoot({ evm: evmRootHex, btc: '0'.repeat(64), ipfs: ipfsRootHex, sleeves: sleevesRootHex });

      const anchor = await medulla.submitCoherenceRoot({
        crossRoot: cross, evmRoot: evmRootHex, ipfsRoot: ipfsRootHex, sleevesRoot: sleevesRootHex,
      }).catch((e: any) => { log.warn({ err: String(e) }, 'submitCoherenceRoot failed'); return null; });

      if (anchor) {
        currentEpoch = anchor.epoch ?? currentEpoch + 1;

        // Retrieve the synaptic-field MMR root from medulla for the new block.
        let synapticRoot = '0'.repeat(64);
        try {
          const proof = await medulla.getSynapticProof(anchor.blockHash);
          synapticRoot = proof.root;
        } catch { /* first block may not have proof yet */ }

        // Bridge anchor to cortex-evm EpochAnchor contract.
        if (EPOCH_ANCHOR_ADDR) {
          try {
            const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, '').padStart(64, '0')}`;
            const hash = await wallet.writeContract({
              address: EPOCH_ANCHOR_ADDR,
              abi: EPOCH_ANCHOR_ABI,
              functionName: 'commitAnchor',
              args: [
                BigInt(currentEpoch),
                pad(cross), pad(evmRootHex), pad(ipfsRootHex), pad(sleevesRootHex),
                pad(synapticRoot), BigInt(anchor.height ?? 0),
              ],
              chain: wallet.chain!, account: wallet.account!,
            });
            await cortex.waitForTransactionReceipt({ hash });
            log.info({ epoch: currentEpoch, txHash: hash }, 'EpochAnchor committed on cortex');
          } catch (e: any) {
            log.warn({ err: String(e) }, 'cortex EpochAnchor commit failed');
          }
        }

        await db.epoch.upsert({
          where: { number: currentEpoch },
          create: {
            number: currentEpoch, crossRoot: cross, evmRoot: evmRootHex,
            ipfsRoot: ipfsRootHex, sleevesRoot: sleevesRootHex,
            medullaHeight: BigInt(anchor.height ?? 0), anchorBlockHash: anchor.blockHash ?? null,
          },
          update: {},
        }).catch(() => {});
        await bus.publish({ type: 'epoch.transition', epoch: currentEpoch, crossRoot: cross, ts: Date.now() } as any);
        log.info({ epoch: currentEpoch, evm: evmHashes.length, ipfs: ipfsHashes.length, sleeves: sleeveHashes.length }, 'epoch.transition');
      }
      evmHashes.length = 0; ipfsHashes.length = 0; sleeveHashes.length = 0;
    } catch (e) {
      log.error({ err: String(e) }, 'tick failed');
    }
  }
  const t = setInterval(tick, EPOCH_INTERVAL_MS);

  app.get('/v1/epoch', async () => ({ epoch: currentEpoch }));
  app.post('/v1/epoch/tick', async () => { await tick(); return { ok: true, epoch: currentEpoch }; });

  wireShutdown(app, async () => clearInterval(t));
  await listen(app, PORT);
}
main().catch((e) => { console.error(e); process.exit(1); });
