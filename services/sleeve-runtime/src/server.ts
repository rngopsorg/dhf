// Sleeve Runtime — embodied agent process.
// One container per sleeve replica; SLEEVE_KIND ∈ {human,ai,mining,memory}
// dictates behavior. Each replica auto-registers a fresh sleeve identity
// against the synapse-api and runs the kind-specific event loop.
import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import os from 'node:os';

type Kind = 'human' | 'ai' | 'mining' | 'memory';
const KIND = (process.env.SLEEVE_KIND ?? 'human') as Kind;
const STACK_ID = process.env.SLEEVE_STACK_ID; // optional pre-bound stack
const SYNAPSE = process.env.SYNAPSE_URL ?? 'http://synapse-api:7070';
const PORT = Number(process.env.SLEEVE_PORT ?? 0);
const TICK_MS = Number(process.env.SLEEVE_TICK_MS ?? 8000);
const HOSTNAME = os.hostname();

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(SYNAPSE + path, {
    ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function ensureStack(): Promise<string> {
  if (STACK_ID) return STACK_ID;
  const list = await api<any[]>(`/v1/stacks`);
  if (list.length > 0) return list[0].id;
  const created = await api<any>(`/v1/stacks`, {
    method: 'POST', body: JSON.stringify({ name: `auto-${HOSTNAME}`, kind: KIND === 'ai' ? 'ai' : 'human' }),
  });
  return created.id;
}

const aiPrompts = [
  'Decompose the residue: which kind?',
  'Estimate drift between this sleeve and tip.',
  'What does coherence imply at epoch boundary?',
  'Identify the marginal benefit of this synaptic write.',
];
const humanThoughts = [
  'I remember the rain through the window.',
  'A name on the tip of my tongue — gone.',
  'The corridor smells like ozone again.',
  'Was that voice mine or someone else’s?',
];

async function tickHuman(sleeveId: string) {
  const t = humanThoughts[Math.floor(Math.random() * humanThoughts.length)];
  await api(`/v1/sleeves/${sleeveId}/perceive`, { method: 'POST', body: JSON.stringify({ input: t }) }).catch(() => {});
}
async function tickAI(sleeveId: string) {
  // Optional: call ollama if configured (LLM_PROVIDER=ollama)
  let prompt = aiPrompts[Math.floor(Math.random() * aiPrompts.length)];
  if (process.env.LLM_PROVIDER === 'ollama' && process.env.OLLAMA_URL) {
    try {
      const r = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'llama3.2:1b', prompt, stream: false }),
      });
      if (r.ok) prompt = ((await r.json()) as any).response ?? prompt;
    } catch { /* fall back to canned */ }
  }
  await api(`/v1/sleeves/${sleeveId}/perceive`, { method: 'POST', body: JSON.stringify({ input: prompt }) }).catch(() => {});
}
async function tickMining() {
  await fetch('http://medulla-pow:8332/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'joinpool', params: { pool: 'main', sleeveId: HOSTNAME } }),
  }).catch(() => {});
}
async function tickMemory(sleeveId: string) {
  await api(`/v1/sleeves/${sleeveId}/sync`, { method: 'POST' }).catch(() => {});
}

async function main() {
  const app = await createService({ name: `sleeve-${KIND}` });
  const bus = await getBus();
  const stackId = await ensureStack();

  const created = await api<any>(`/v1/sleeves`, {
    method: 'POST',
    body: JSON.stringify({ stackId, embodimentType: KIND, hostname: HOSTNAME }),
  });
  const sleeveId = created.id as string;
  app.log.info({ sleeveId, kind: KIND, stackId }, 'sleeve registered');

  app.get('/identity', async () => ({ sleeveId, kind: KIND, stackId, hostname: HOSTNAME }));

  const tick = setInterval(() => {
    const fn =
      KIND === 'ai' ? () => tickAI(sleeveId) :
      KIND === 'mining' ? tickMining :
      KIND === 'memory' ? () => tickMemory(sleeveId) :
      () => tickHuman(sleeveId);
    Promise.resolve(fn()).catch((e) => app.log.warn({ err: String(e) }, 'tick failed'));
  }, TICK_MS);

  wireShutdown(app, async () => {
    clearInterval(tick);
    await api(`/v1/sleeves/${sleeveId}`, { method: 'DELETE' }).catch(() => {});
  });

  if (PORT > 0) await listen(app, PORT);
  else app.log.info({ kind: KIND }, 'sleeve runtime running (no http port)');
}
main().catch((e) => { console.error(e); process.exit(1); });
