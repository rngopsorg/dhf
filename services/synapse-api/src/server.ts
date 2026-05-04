// Synapse API — Envoy Interface — REST + WebSocket + GraphQL gateway.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import { getDb } from '@ecca/db';
import { genIdentityKeypair, sha256hex, cid as makeCid, encrypt, epochKey, merkleRoot, sign } from '@ecca/crypto';
import { HippocampusClient, MedullaClient, cortexPublic } from '@ecca/chain';
import { DEFAULT_BALANCE, type EmbodimentType } from '@ecca/proto';
import websocket from '@fastify/websocket';
import { z } from 'zod';

const PORT = Number(process.env.SYNAPSE_PORT ?? 7070);

async function main() {
  const app = await createService({ name: 'synapse-api' });
  const log = app.log;
  await app.register(websocket);

  const db = getDb();
  const bus = await getBus();
  const hippo = new HippocampusClient();
  const medulla = new MedullaClient();
  const cortex = cortexPublic();

  // ─── WebSocket fanout ─────────────────────────────────────────────────────
  const wsClients = new Set<any>();
  app.get('/ws', { websocket: true }, (conn) => {
    wsClients.add(conn);
    conn.socket.on('close', () => wsClients.delete(conn));
  });
  // forward all bus events to ws clients
  bus.subscribe('ecca.>', 'synapse-ws-fanout', async (ev) => {
    const msg = JSON.stringify(ev);
    for (const c of wsClients) {
      try { c.socket.send(msg); } catch { /* drop */ }
    }
  }).catch((e) => log.error({ err: e }, 'ws fanout failed'));

  // ─── STACKS ───────────────────────────────────────────────────────────────

  const CreateStack = z.object({
    name: z.string().min(1).max(64),
    kind: z.enum(['human', 'ai']).default('human'),
  });
  app.post('/v1/stacks', async (req, reply) => {
    const body = CreateStack.parse(req.body);
    const kp = genIdentityKeypair();
    const tokenIdHint = (await db.stack.count()) + 1;
    const id = `stack:${body.kind}:${tokenIdHint}:${sha256hex(body.name + Date.now()).slice(0, 12)}`;
    const stack = await db.stack.create({
      data: {
        id, tokenId: tokenIdHint, name: body.name, kind: body.kind,
        pubKey: kp.pub, epoch: 0,
        cpv: { computeCoeff: 1, memoryCoeff: 1, syncCoeff: 1, routingCoeff: 1, residueCoeff: 1 },
        binding: { decayRate: 0.05, floor: 0.25 },
      },
    });
    bus.publish({
      type: 'stack.created', stackId: stack.id, name: stack.name, kind: stack.kind,
      tokenId: stack.tokenId, pubkey: kp.pub, ts: Date.now(),
    } as any).catch(() => {});
    return reply.send({ ...stack, identityPriv: kp.priv });
  });

  app.get('/v1/stacks', async () => db.stack.findMany({ include: { sleeves: true } }));
  app.get('/v1/stacks/:id', async (req: any, reply) => {
    const s = await db.stack.findUnique({ where: { id: req.params.id }, include: { sleeves: true, anchors: true } });
    if (!s) return reply.code(404).send({ error: 'not found' });
    return s;
  });

  // Memory write — encrypts under epoch key + posts to hippocampus.
  const Remember = z.object({ text: z.string().min(1), pin: z.boolean().default(false) });
  app.post('/v1/stacks/:id/remember', async (req: any, reply) => {
    const body = Remember.parse(req.body);
    const stack = await db.stack.findUnique({ where: { id: req.params.id } });
    if (!stack) return reply.code(404).send({ error: 'not found' });
    const k = epochKey(stack.id, stack.epoch);
    const ciphertext = encrypt(body.text, k);
    const links = stack.episodicHead ? [stack.episodicHead] : [];
    const { cid } = await hippo.put({
      stackId: stack.id, epoch: stack.epoch, ciphertext, links, kind: 'episodic', pinned: body.pin,
    });
    await db.stack.update({ where: { id: stack.id }, data: { episodicHead: cid } });
    return { cid };
  });

  app.get('/v1/stacks/:id/recall', async (req: any, reply) => {
    const stack = await db.stack.findUnique({ where: { id: req.params.id } });
    if (!stack) return reply.code(404).send({ error: 'not found' });
    if (!stack.episodicHead) return { fragments: [], broken: [], fidelity: 1 };
    const depth = Math.min(32, Number((req.query as any)?.depth ?? 6));
    const memToken = Number((req.query as any)?.memoryToken ?? DEFAULT_BALANCE.memory);
    const r = await hippo.recall({
      rootCid: stack.episodicHead, stackId: stack.id, epoch: stack.epoch, depth, memoryToken: memToken,
    });
    bus.publish({
      type: 'memory.recall', stackId: stack.id, rootCid: stack.episodicHead,
      fidelity: r.fidelity, fragments: r.fragments.length, broken: r.broken.length, ts: Date.now(),
    } as any).catch(() => {});
    return r;
  });

  // ─── SLEEVES ──────────────────────────────────────────────────────────────

  const SpawnSleeve = z.object({
    stackId: z.string(),
    embodimentType: z.enum(['human', 'ai', 'mining', 'memory']).default('human'),
    hostname: z.string().optional(),
  });
  app.post('/v1/sleeves', async (req, reply) => {
    const body = SpawnSleeve.parse(req.body);
    const stack = await db.stack.findUnique({ where: { id: body.stackId } });
    if (!stack) return reply.code(404).send({ error: 'stack not found' });
    const ix = (await db.sleeve.count({ where: { stackId: stack.id } })) + 1;
    const id = `sleeve:${body.embodimentType}:${ix}:${sha256hex(stack.id + Date.now()).slice(0, 8)}`;
    const sleeve = await db.sleeve.create({
      data: {
        id, stackId: stack.id, embodimentType: body.embodimentType,
        alive: true, drift: 0, syncEpoch: stack.epoch,
        tokens: { compute: 250, memory: 250, sync: 250, routing: 250, residue: 0 },
        hostname: body.hostname ?? null,
      },
    });
    bus.publish({
      type: 'sleeve.spawned', sleeveId: sleeve.id, stackId: stack.id,
      embodimentType: body.embodimentType, ts: Date.now(),
    } as any).catch(() => {});
    return sleeve;
  });

  app.get('/v1/sleeves', async () => db.sleeve.findMany({ where: { alive: true } }));
  app.delete('/v1/sleeves/:id', async (req: any, reply) => {
    const s = await db.sleeve.update({ where: { id: req.params.id }, data: { alive: false } }).catch(() => null);
    if (!s) return reply.code(404).send({ error: 'not found' });
    bus.publish({ type: 'sleeve.decommissioned', sleeveId: s.id, stackId: s.stackId, ts: Date.now() } as any).catch(() => {});
    return { ok: true };
  });

  app.post('/v1/sleeves/:id/perceive', async (req: any, reply) => {
    const s = await db.sleeve.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not found' });
    const stack = await db.stack.findUnique({ where: { id: s.stackId } });
    if (!stack) return reply.code(404).send({ error: 'stack gone' });
    const tokens = s.tokens as any;
    if ((tokens.compute ?? 0) < 1) return reply.code(402).send({ error: 'compute_token_exhausted' });

    const text = String((req.body as any)?.input ?? '');
    const thought = `[${s.embodimentType}@${s.id.slice(-6)}] ${text}`;
    const k = epochKey(stack.id, stack.epoch);
    const ciphertext = encrypt(thought, k);
    const links = stack.episodicHead ? [stack.episodicHead] : [];
    const { cid } = await hippo.put({
      stackId: stack.id, epoch: stack.epoch, ciphertext, links, kind: 'episodic',
    });
    await db.$transaction([
      db.stack.update({ where: { id: stack.id }, data: { episodicHead: cid } }),
      db.sleeve.update({
        where: { id: s.id },
        data: {
          drift: { increment: 1 },
          tokens: { ...tokens, compute: tokens.compute - 0.5 },
        },
      }),
    ]);
    bus.publish({
      type: 'sleeve.perceive', sleeveId: s.id, stackId: stack.id,
      cid, computeCost: 0.5, ts: Date.now(),
    } as any).catch(() => {});
    return { cid, thought };
  });

  app.post('/v1/sleeves/:id/sync', async (req: any, reply) => {
    const s = await db.sleeve.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not found' });
    const stack = await db.stack.findUnique({ where: { id: s.stackId } });
    if (!stack) return reply.code(404).send({ error: 'stack gone' });
    const tokens = s.tokens as any;
    if ((tokens.sync ?? 0) < 1) return reply.code(402).send({ error: 'sync_token_exhausted' });
    await db.sleeve.update({
      where: { id: s.id },
      data: {
        drift: 0, syncEpoch: stack.epoch, lastSync: new Date(),
        tokens: { ...tokens, sync: tokens.sync - 1 },
      },
    });
    return { ok: true, epoch: stack.epoch };
  });

  // ─── NEEDLECAST ───────────────────────────────────────────────────────────

  const Needlecast = z.object({ from: z.string(), to: z.string() });
  app.post('/v1/needlecast', async (req, reply) => {
    const body = Needlecast.parse(req.body);
    // Delegate to needlecast-router-svc via bus RPC pattern (request/reply)
    const replyJson = await fetch('http://needlecast-router-svc:7071/needlecast', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    return reply.send(replyJson);
  });

  // ─── EPOCHS / MINING / RESIDUE ───────────────────────────────────────────

  app.get('/v1/epochs/current', async () => {
    const info = await medulla.getInfo().catch(() => null);
    return { epoch: info?.epoch ?? 0, height: info?.height ?? 0, tip: info?.tip ?? null };
  });

  app.post('/v1/mining/block', async () => {
    return medulla.mineBlock();
  });

  app.get('/v1/coordination/desync', async () => {
    const drifty = await db.sleeve.findMany({
      where: { alive: true, drift: { gt: Number(process.env.ECCA_DRIFT_MAX ?? 15) } },
      select: { id: true, stackId: true, drift: true },
    });
    return drifty;
  });

  app.get('/v1/coordination/residues', async () =>
    db.residue.findMany({ orderBy: { detectedAt: 'desc' }, take: 50 }),
  );

  app.get('/v1/tokens/balances/:stackId', async (req: any, reply) => {
    const s = await db.stack.findUnique({ where: { id: req.params.stackId } });
    if (!s) return reply.code(404).send({ error: 'not found' });
    // Sum from sleeves + (eventually) on-chain bandwidth contracts.
    const sleeves = await db.sleeve.findMany({ where: { stackId: s.id, alive: true }, select: { tokens: true } });
    const totals = { compute: 0, memory: 0, sync: 0, routing: 0, residue: 0 };
    for (const sl of sleeves) {
      const t = sl.tokens as any;
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(t[k] ?? 0);
    }
    return { stackId: s.id, sleeveTotals: totals };
  });

  // ─── BOOT ─────────────────────────────────────────────────────────────────

  wireShutdown(app);
  await listen(app, PORT);
}

main().catch((e) => { console.error(e); process.exit(1); });
