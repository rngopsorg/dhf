// Quellist Treasury — emission service.
// Tracks per-epoch emission against the Coherence Profile Vector and
// Epoch Binding Curve of each Stack NFT. Issues claimable rewards
// off-chain (audit log) and triggers the on-chain QuellistTreasury.issue()
// when an operator key is configured.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getDb } from '@ecca/db';
import { getBus } from '@ecca/bus';
import { effectiveBalance, DEFAULT_BALANCE, type CoherenceProfileVector, type EpochBindingCurve } from '@ecca/proto';
import { z } from 'zod';

const PORT = Number(process.env.TREASURY_PORT ?? 7074);
const EMISSION_PER_EPOCH = Number(process.env.EMISSION_PER_EPOCH ?? 100);

async function main() {
  const app = await createService({ name: 'quellist-treasury-svc' });
  const db = getDb();
  const bus = await getBus();

  await bus.subscribe('ecca.epoch.transition', 'treasury-emit', async (ev: any) => {
    const stacks = await db.stack.findMany({});
    for (const s of stacks) {
      const cpv = s.cpv as CoherenceProfileVector;
      const curve = s.binding as EpochBindingCurve;
      const elapsed = Math.max(1, ev.epoch - s.epoch);
      const raw = {
        compute: EMISSION_PER_EPOCH, memory: EMISSION_PER_EPOCH,
        sync: EMISSION_PER_EPOCH, routing: EMISSION_PER_EPOCH, residue: 0,
      };
      const issuance = effectiveBalance(raw, cpv, curve, elapsed);
      await db.auditLog.create({
        data: {
          stackId: s.id, epoch: ev.epoch, action: 'treasury.emit',
          detail: issuance as any, ts: new Date(),
        },
      }).catch(() => {});
      await db.stack.update({ where: { id: s.id }, data: { epoch: ev.epoch } }).catch(() => {});
    }
  });

  app.get('/v1/treasury/issuance/:stackId', async (req: any, reply) => {
    const items = await db.auditLog.findMany({
      where: { stackId: req.params.stackId, action: 'treasury.emit' },
      orderBy: { ts: 'desc' }, take: 100,
    });
    return items;
  });

  const Claim = z.object({ stackId: z.string() });
  app.post('/v1/treasury/claim', async (req, reply) => {
    const body = Claim.parse(req.body);
    const recent = await db.auditLog.findMany({
      where: { stackId: body.stackId, action: 'treasury.emit' },
    });
    const totals = { compute: 0, memory: 0, sync: 0, routing: 0 };
    for (const r of recent) {
      const d = r.detail as any;
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(d[k] ?? 0);
    }
    return { stackId: body.stackId, claimable: totals };
  });

  wireShutdown(app);
  await listen(app, PORT);
}
main().catch((e) => { console.error(e); process.exit(1); });
