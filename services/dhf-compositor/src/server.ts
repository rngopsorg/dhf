// DHF Compositor — reconstruction service.
// Given (stackId, sleeveId, depth), walk the hippocampus DAG with
// memory-token gating and decrypt fragments under the per-epoch key.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getDb } from '@ecca/db';
import { decrypt, epochKey } from '@ecca/crypto';
import { HippocampusClient } from '@ecca/chain';
import { z } from 'zod';

const PORT = Number(process.env.COMPOSITOR_PORT ?? 7073);

const ReconstructReq = z.object({
  stackId: z.string(),
  sleeveId: z.string().optional(),
  depth: z.number().int().min(1).max(64).default(8),
});

async function main() {
  const app = await createService({ name: 'dhf-compositor' });
  const db = getDb();
  const hippo = new HippocampusClient();

  app.post('/v1/reconstruct', async (req, reply) => {
    const body = ReconstructReq.parse(req.body);
    const stack = await db.stack.findUnique({ where: { id: body.stackId } });
    if (!stack) return reply.code(404).send({ error: 'stack not found' });
    if (!stack.episodicHead) return { ok: true, fragments: [], fidelity: 1, broken: [] };

    let memoryToken = body.depth;
    if (body.sleeveId) {
      const s = await db.sleeve.findUnique({ where: { id: body.sleeveId } });
      memoryToken = Number((s?.tokens as any)?.memory ?? body.depth);
    }
    const r = await hippo.recall({
      rootCid: stack.episodicHead, stackId: stack.id, epoch: stack.epoch,
      depth: body.depth, memoryToken,
    });

    const k = epochKey(stack.id, stack.epoch);
    const decoded: Array<{ cid: string; epoch: number; text?: string; error?: string }> = [];
    for (const frag of r.fragments) {
      try {
        const text = decrypt(frag.ciphertext as any, k);
        decoded.push({ cid: frag.cid, epoch: frag.epoch, text });
      } catch (e: any) {
        decoded.push({ cid: frag.cid, epoch: frag.epoch, error: e.message });
      }
    }
    return { ok: true, fragments: decoded, broken: r.broken, fidelity: r.fidelity };
  });

  wireShutdown(app);
  await listen(app, PORT);
}
main().catch((e) => { console.error(e); process.exit(1); });
