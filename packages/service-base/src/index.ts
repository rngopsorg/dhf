// Shared service bootstrap helpers — every TS service / worker uses these.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import pino from 'pino';

export interface ServiceConfig {
  name: string;
  port?: number;
  cors?: boolean;
}

export function createLogger(name: string) {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export async function createService(cfg: ServiceConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLogger(cfg.name),
    disableRequestLogging: process.env.LOG_LEVEL !== 'debug',
    bodyLimit: 8 * 1024 * 1024,
  });
  if (cfg.cors !== false) {
    await app.register(cors, { origin: process.env.SYNAPSE_CORS_ORIGIN ?? '*' });
  }
  app.get('/healthz', async () => ({ ok: true, name: cfg.name, ts: Date.now() }));
  app.get('/readyz', async () => ({ ready: true, name: cfg.name, ts: Date.now() }));
  return app;
}

export async function listen(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ host: '0.0.0.0', port });
  app.log.info({ port }, 'service listening');
}

/** Standard graceful-shutdown wiring. */
export function wireShutdown(app: FastifyInstance, extra?: () => Promise<void>): void {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      app.log.info({ sig }, 'shutting down');
      try { await extra?.(); } catch (e) { app.log.error({ err: e }, 'extra shutdown failed'); }
      await app.close();
      process.exit(0);
    });
  }
}

/** Long-running daemon that has no HTTP surface. */
export function daemon(name: string, run: () => Promise<void>): void {
  const log = createLogger(name);
  process.on('uncaughtException', (e) => log.error({ err: e }, 'uncaughtException'));
  process.on('unhandledRejection', (e) => log.error({ err: e }, 'unhandledRejection'));
  run().catch((e) => { log.error({ err: e }, 'daemon crashed'); process.exit(1); });
}
