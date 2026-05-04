// Thalamus Router — cross-shard event arbiter.
// Subscribes to all chain events, computes the per-epoch crossRoot, and
// submits it to medulla-pow. Acts as the source of truth for "current epoch".
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import { getDb } from '@ecca/db';
import { merkleRoot, sha256, sha256hex, coherenceRoot } from '@ecca/crypto';
import { MedullaClient } from '@ecca/chain';
import { EPOCH_INTERVAL_MS } from '@ecca/proto';

const PORT = Number(process.env.THALAMUS_PORT ?? 7072);

async function main() {
  const app = await createService({ name: 'thalamus-router' });
  const log = app.log;
  const bus = await getBus();
  const db = getDb();
  const medulla = new MedullaClient();

  // Buffered event hashes per epoch — drained at each epoch tick.
  let currentEpoch = 0;
  const evmHashes: string[] = [];
  const ipfsHashes: string[] = [];
  const sleeveHashes: string[] = [];

  const hex32 = (b: Uint8Array) => Buffer.from(b).toString('hex');

  // Aggregate hippocampus + EVM + sleeve events.
  await bus.subscribe('ecca.memory.>', 'thalamus-mem', async (ev: any) => {
    if (ev?.cid) ipfsHashes.push(sha256hex(ev.cid));
  });
  await bus.subscribe('ecca.sleeve.>', 'thalamus-sleeve', async (ev: any) => {
    sleeveHashes.push(sha256hex(JSON.stringify({ t: ev.type, id: ev.sleeveId ?? ev.stackId })));
  });
  await bus.subscribe('ecca.chain.evm.>', 'thalamus-evm', async (ev: any) => {
    if (ev?.txHash) evmHashes.push(ev.txHash);
  });

  // Epoch tick — every EPOCH_INTERVAL_MS, fold buffers into a coherence root and submit.
  async function tick() {
    try {
      const evmRoot = evmHashes.length ? merkleRoot(evmHashes.map(h => Buffer.from(h, 'hex'))) : new Uint8Array(32);
      const ipfsRoot = ipfsHashes.length ? merkleRoot(ipfsHashes.map(h => Buffer.from(h, 'hex'))) : new Uint8Array(32);
      const sleevesRoot = sleeveHashes.length ? merkleRoot(sleeveHashes.map(h => Buffer.from(h, 'hex'))) : new Uint8Array(32);
      const cross = coherenceRoot({ evm: evmRoot, btc: new Uint8Array(32), ipfs: ipfsRoot, sleeves: sleevesRoot });

      const anchor = await medulla.submitCoherenceRoot({
        crossRoot: hex32(cross), evmRoot: hex32(evmRoot), ipfsRoot: hex32(ipfsRoot), sleevesRoot: hex32(sleevesRoot),
      }).catch((e: any) => { log.warn({ err: String(e) }, 'submitCoherenceRoot failed'); return null; });

      if (anchor) {
        currentEpoch = anchor.epoch ?? currentEpoch + 1;
        await db.epoch.upsert({
          where: { number: currentEpoch },
          create: {
            number: currentEpoch, crossRoot: hex32(cross), evmRoot: hex32(evmRoot),
            ipfsRoot: hex32(ipfsRoot), sleevesRoot: hex32(sleevesRoot),
            medullaHeight: BigInt(anchor.height ?? 0), anchorBlockHash: anchor.blockHash ?? null,
          },
          update: {},
        }).catch(() => {});
        await bus.publish({ type: 'epoch.transition', epoch: currentEpoch, crossRoot: hex32(cross), ts: Date.now() } as any);
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
