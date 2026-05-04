// Worker Runner — switches behavior on WORKER_KIND.
// Each worker is an independent BullMQ-style consumer (we use a NATS
// JetStream durable subscription as the queue) — no centralized scheduler.
import { daemon, createLogger } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import { getDb } from '@ecca/db';
import { HippocampusClient, MedullaClient, cortexPublic } from '@ecca/chain';
import { sha256hex } from '@ecca/crypto';
import { ResidueKind, DRIFT_MAX_DEFAULT } from '@ecca/proto';

type Kind =
  | 'epoch-anchor'
  | 'drift-detector'
  | 'residue-collector'
  | 'memory-reconciler'
  | 'pinning-service'
  | 'bandwidth-meter';

const KIND = (process.env.WORKER_KIND ?? 'drift-detector') as Kind;
const log = createLogger(`worker-${KIND}`);

async function epochAnchor() {
  const bus = await getBus();
  const db = getDb();
  const medulla = new MedullaClient();
  await bus.subscribe('ecca.epoch.transition', `worker-epoch-anchor`, async (ev: any) => {
    try {
      const anchor = await medulla.getLatestAnchor();
      await db.anchor.create({
        data: {
          epoch: ev.epoch, height: BigInt(anchor.height ?? 0),
          blockHash: anchor.blockHash, crossRoot: anchor.crossRoot,
          evmRoot: anchor.evmRoot, ipfsRoot: anchor.ipfsRoot,
          sleevesRoot: anchor.sleevesRoot, synapticFieldRoot: anchor.synapticFieldRoot,
          ts: new Date(),
        },
      }).catch(() => {});
      log.info({ epoch: ev.epoch, height: anchor.height }, 'anchor recorded');
    } catch (e) { log.error({ err: String(e) }, 'epoch-anchor failed'); }
  });
}

async function driftDetector() {
  const bus = await getBus();
  const db = getDb();
  const max = Number(process.env.ECCA_DRIFT_MAX ?? DRIFT_MAX_DEFAULT);
  setInterval(async () => {
    const drifty = await db.sleeve.findMany({ where: { alive: true, drift: { gt: max } } });
    for (const s of drifty) {
      await bus.publish({
        type: 'sleeve.drift', sleeveId: s.id, stackId: s.stackId, drift: s.drift, ts: Date.now(),
      } as any);
      if (s.drift > max * 2) {
        await bus.publish({
          type: 'sleeve.desync', sleeveId: s.id, stackId: s.stackId, drift: s.drift, ts: Date.now(),
        } as any);
      }
    }
    if (drifty.length) log.info({ n: drifty.length }, 'drift events emitted');
  }, 5000);
}

async function residueCollector() {
  const bus = await getBus();
  const db = getDb();
  await bus.subscribe('ecca.sleeve.desync', 'worker-residue', async (ev: any) => {
    const id = sha256hex(`desync:${ev.sleeveId}:${ev.ts}`);
    await db.residue.create({
      data: {
        id, kind: ResidueKind.SpeculativeDivergence as any,
        stackId: ev.stackId, sleeveId: ev.sleeveId,
        status: 'open', payoutEst: 5,
      },
    }).catch(() => {});
    await bus.publish({
      type: 'coordination.residue.detected', residueId: id,
      kind: 'speculative-divergence', stackId: ev.stackId, ts: Date.now(),
    } as any);
  });
  await bus.subscribe('ecca.epoch.transition', 'worker-residue-stale', async (ev: any) => {
    const stale = await db.sleeve.findMany({
      where: { alive: true, syncEpoch: { lt: ev.epoch - 4 } },
    });
    for (const s of stale) {
      const id = sha256hex(`stale:${s.id}:${ev.epoch}`);
      await db.residue.create({
        data: {
          id, kind: ResidueKind.StaleOrdering as any,
          stackId: s.stackId, sleeveId: s.id, status: 'open', payoutEst: 2,
        },
      }).catch(() => {});
    }
  });
}

async function memoryReconciler() {
  const bus = await getBus();
  const db = getDb();
  const hippo = new HippocampusClient();
  await bus.subscribe('ecca.epoch.transition', 'worker-mem-reconcile', async (ev: any) => {
    // For each stack, walk a small window of the DAG and verify pin status.
    const stacks = await db.stack.findMany({ where: { episodicHead: { not: null } }, take: 100 });
    let healed = 0;
    for (const s of stacks) {
      if (!s.episodicHead) continue;
      const r = await hippo.recall({
        rootCid: s.episodicHead, stackId: s.id, epoch: s.epoch, depth: 4, memoryToken: 100,
      }).catch(() => null);
      if (r?.broken?.length) {
        for (const cid of r.broken) {
          if (!cid.includes('#')) await hippo.pin(cid).catch(() => {});
        }
        healed += r.broken.length;
      }
    }
    if (healed) log.info({ epoch: ev.epoch, healed }, 'reconciliation pass complete');
  });
}

async function pinningService() {
  const bus = await getBus();
  const hippo = new HippocampusClient();
  await bus.subscribe('ecca.needlecast.route', 'worker-pinning', async (ev: any) => {
    for (const cid of ev.shards ?? []) await hippo.pin(cid).catch(() => {});
  });
}

async function bandwidthMeter() {
  const bus = await getBus();
  const db = getDb();
  // accumulate per-stack-per-epoch consumption, persist to AuditLog.
  const acc = new Map<string, { compute: number; memory: number; routing: number; sync: number }>();
  function bump(stack: string, k: 'compute' | 'memory' | 'routing' | 'sync', v: number) {
    const cur = acc.get(stack) ?? { compute: 0, memory: 0, routing: 0, sync: 0 };
    cur[k] += v; acc.set(stack, cur);
  }
  await bus.subscribe('ecca.sleeve.perceive', 'worker-bw-percv', async (ev: any) => bump(ev.stackId, 'compute', ev.computeCost ?? 0.5));
  await bus.subscribe('ecca.memory.recall', 'worker-bw-recall', async (ev: any) => bump(ev.stackId, 'memory', ev.fragments ?? 0));
  await bus.subscribe('ecca.needlecast.route', 'worker-bw-route', async (ev: any) => bump(ev.stackId, 'routing', 5));
  await bus.subscribe('ecca.epoch.transition', 'worker-bw-flush', async (ev: any) => {
    for (const [stackId, c] of acc.entries()) {
      await db.auditLog.create({
        data: {
          stackId, epoch: ev.epoch,
          action: 'bandwidth.consumed', detail: c as any, ts: new Date(),
        },
      }).catch(() => {});
    }
    acc.clear();
  });
}

const fns: Record<Kind, () => Promise<void>> = {
  'epoch-anchor': epochAnchor,
  'drift-detector': driftDetector,
  'residue-collector': residueCollector,
  'memory-reconciler': memoryReconciler,
  'pinning-service': pinningService,
  'bandwidth-meter': bandwidthMeter,
};

daemon(`worker-${KIND}`, async () => {
  log.info({ kind: KIND }, 'worker starting');
  await fns[KIND]();
  // keep alive
  await new Promise(() => {});
});
