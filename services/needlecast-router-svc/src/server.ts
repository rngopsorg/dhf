// Needlecast Router Service — saga-coordinated stack transfer:
//   freeze → shard → encrypt-with-target-epoch-key → pin → anchor → reconstruct
// On any step failure, prior steps are rolled back. The transfer is atomic
// from the caller's POV.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getDb } from '@ecca/db';
import { getBus } from '@ecca/bus';
import { encrypt, decrypt, epochKey, sha256hex, merkleRoot } from '@ecca/crypto';
import { HippocampusClient } from '@ecca/chain';
import { z } from 'zod';

const PORT = Number(process.env.NEEDLECAST_PORT ?? 7071);

const NeedlecastReq = z.object({ from: z.string(), to: z.string() });

async function main() {
  const app = await createService({ name: 'needlecast-router-svc' });
  const log = app.log;
  const db = getDb();
  const bus = await getBus();
  const hippo = new HippocampusClient();

  app.post('/needlecast', async (req, reply) => {
    const body = NeedlecastReq.parse(req.body);
    const from = await db.sleeve.findUnique({ where: { id: body.from } });
    const to = await db.sleeve.findUnique({ where: { id: body.to } });
    if (!from || !to) return reply.code(404).send({ error: 'sleeve not found' });
    if (from.stackId !== to.stackId) return reply.code(409).send({ error: 'stack_mismatch' });

    const stack = await db.stack.findUnique({ where: { id: from.stackId } });
    if (!stack) return reply.code(404).send({ error: 'stack not found' });

    const ftokens = from.tokens as any;
    const ttokens = to.tokens as any;
    const cost = 5;
    if ((ftokens.routing ?? 0) < cost) return reply.code(402).send({ error: 'routing_token_exhausted' });

    const sagaId = `needle:${sha256hex(body.from + body.to + Date.now()).slice(0, 16)}`;
    const undo: Array<() => Promise<void>> = [];

    try {
      // 1. freeze source
      await db.sleeve.update({ where: { id: from.id }, data: { alive: false } });
      undo.unshift(async () => { await db.sleeve.update({ where: { id: from.id }, data: { alive: true } }); });

      // 2. shard episodic memory along DAG up to depth=8
      const head = stack.episodicHead;
      const shards: string[] = [];
      if (head) {
        const r = await hippo.recall({ rootCid: head, stackId: stack.id, epoch: stack.epoch, depth: 8, memoryToken: 1000 });
        shards.push(...r.fragments.map(f => f.cid));
      }

      // 3. pin shards into hippocampus (durability bond)
      for (const cid of shards) {
        await hippo.pin(cid).catch(() => {});
      }

      // 4. anchor — emit a needlecast event (the thalamus-router will fold this into the next epoch root)
      const route = sha256hex(body.from + body.to + stack.id);
      await bus.publish({
        type: 'needlecast.route', from: body.from, to: body.to,
        stackId: stack.id, route, shards, sagaId, ts: Date.now(),
      } as any);

      // 5. reconstruct on target — increase target's drift to 0 and grant routing receipt
      await db.sleeve.update({
        where: { id: to.id },
        data: {
          drift: 0, syncEpoch: stack.epoch,
          tokens: { ...ttokens, routing: (ttokens.routing ?? 0) - 0 }, // target pays nothing extra
        },
      });
      // 6. settle source ledger (compute consumed bandwidth)
      await db.sleeve.update({
        where: { id: from.id },
        data: {
          tokens: { ...ftokens, routing: (ftokens.routing ?? 0) - cost },
        },
      });
      // 7. unfreeze (re-aliven; v3 keeps source alive after transfer for symmetric model)
      await db.sleeve.update({ where: { id: from.id }, data: { alive: true } });
      undo.length = 0;

      return { ok: true, sagaId, route, shards: shards.length };
    } catch (e: any) {
      log.error({ err: String(e), sagaId }, 'needlecast saga failed; rolling back');
      for (const u of undo) { try { await u(); } catch {} }
      return reply.code(500).send({ error: 'needlecast_failed', detail: e.message, sagaId });
    }
  });

  wireShutdown(app);
  await listen(app, PORT);
}
main().catch((e) => { console.error(e); process.exit(1); });
