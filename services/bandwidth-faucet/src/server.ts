// Bandwidth Faucet — testnet / dev token grant service.
// Rate-limited per stackId, returns a top-up of all 4 core tokens.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getDb } from '@ecca/db';
import { z } from 'zod';

const PORT = Number(process.env.FAUCET_PORT ?? 7075);
const RATE_MS = Number(process.env.FAUCET_RATE_MS ?? 60_000);
const GRANT = { compute: 100, memory: 100, sync: 50, routing: 50 };

async function main() {
  const app = await createService({ name: 'bandwidth-faucet' });
  const db = getDb();
  const last = new Map<string, number>();

  const Drip = z.object({ stackId: z.string() });
  app.post('/v1/faucet/drip', async (req, reply) => {
    const body = Drip.parse(req.body);
    const now = Date.now();
    if ((last.get(body.stackId) ?? 0) + RATE_MS > now) {
      return reply.code(429).send({ error: 'rate_limited', retryAfterMs: RATE_MS - (now - (last.get(body.stackId) ?? 0)) });
    }
    const sleeves = await db.sleeve.findMany({ where: { stackId: body.stackId, alive: true } });
    if (sleeves.length === 0) return reply.code(404).send({ error: 'no_alive_sleeves' });
    for (const s of sleeves) {
      const t = s.tokens as any;
      await db.sleeve.update({
        where: { id: s.id },
        data: {
          tokens: {
            compute: (t.compute ?? 0) + GRANT.compute,
            memory: (t.memory ?? 0) + GRANT.memory,
            sync: (t.sync ?? 0) + GRANT.sync,
            routing: (t.routing ?? 0) + GRANT.routing,
            residue: (t.residue ?? 0),
          },
        },
      });
    }
    last.set(body.stackId, now);
    return { ok: true, granted: GRANT, sleeves: sleeves.length };
  });

  wireShutdown(app);
  await listen(app, PORT);
}
main().catch((e) => { console.error(e); process.exit(1); });
