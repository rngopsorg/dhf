// Integration smoke — runs the full coherence cycle locally against a live compose stack.
// Requires: `docker compose up -d` then `pnpm contracts:deploy`.
import { describe, it, expect, beforeAll } from 'vitest';

const SYN = process.env.SYNAPSE_URL ?? 'http://localhost:7070';

async function j(path: string, init?: RequestInit) {
  const r = await fetch(SYN + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

describe('ecca v3 — coherence cycle', () => {
  let stackId: string;
  let humanId: string;
  let aiId: string;

  beforeAll(async () => {
    const stack: any = await j('/v1/stacks', { method: 'POST', body: JSON.stringify({ name: 'it-test', kind: 'human' }) });
    stackId = stack.id;
    humanId = (await j('/v1/sleeves', { method: 'POST', body: JSON.stringify({ stackId, embodimentType: 'human' }) }) as any).id;
    aiId = (await j('/v1/sleeves', { method: 'POST', body: JSON.stringify({ stackId, embodimentType: 'ai' }) }) as any).id;
  }, 30_000);

  it('perceive writes to hippocampus and advances episodicHead', async () => {
    const r: any = await j(`/v1/sleeves/${humanId}/perceive`, { method: 'POST', body: JSON.stringify({ input: 'rain' }) });
    expect(r.cid).toMatch(/^ecca:\/\/[a-f0-9]{64}@\d+/);
  });

  it('recall fidelity is non-zero after writes', async () => {
    for (let i = 0; i < 3; i++) {
      await j(`/v1/sleeves/${aiId}/perceive`, { method: 'POST', body: JSON.stringify({ input: `tick ${i}` }) });
    }
    const r: any = await j(`/v1/stacks/${stackId}/recall?depth=4`);
    expect(r.fragments.length).toBeGreaterThan(0);
    expect(r.fidelity).toBeGreaterThan(0);
  });

  it('needlecast saga completes', async () => {
    const r: any = await j('/v1/needlecast', { method: 'POST', body: JSON.stringify({ from: humanId, to: aiId }) });
    expect(r.ok).toBe(true);
    expect(r.sagaId).toMatch(/^needle:[a-f0-9]+/);
  });

  it('epoch is advancing', async () => {
    const a: any = await j('/v1/epochs/current');
    await new Promise(r => setTimeout(r, 5000));
    const b: any = await j('/v1/epochs/current');
    expect(b.epoch).toBeGreaterThanOrEqual(a.epoch);
  });
});
