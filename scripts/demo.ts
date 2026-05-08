// End-to-end demo: spin a stack, two sleeves (human + ai), perceive, recall, needlecast.
// Run after `docker compose up -d` and `pnpm contracts:deploy`.
// Usage: pnpm demo
const SYN = process.env.SIYANA_URL ?? 'http://localhost:7070';

async function j<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(SYN + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('▸ creating stack…');
  const stack = await j<any>('/v1/stacks', {
    method: 'POST', body: JSON.stringify({ name: 'demo-pilot', kind: 'human' }),
  });
  console.log('  stack:', stack.id, 'tokenId:', stack.tokenId);

  console.log('▸ spawning sleeves…');
  const human = await j<any>('/v1/sleeves', {
    method: 'POST', body: JSON.stringify({ stackId: stack.id, embodimentType: 'human' }),
  });
  const ai = await j<any>('/v1/sleeves', {
    method: 'POST', body: JSON.stringify({ stackId: stack.id, embodimentType: 'ai' }),
  });
  console.log('  human:', human.id);
  console.log('  ai:   ', ai.id);

  console.log('▸ perceiving…');
  for (let i = 0; i < 5; i++) {
    await j(`/v1/sleeves/${human.id}/perceive`, {
      method: 'POST', body: JSON.stringify({ input: `Memory tick #${i}: the rain remembers me.` }),
    });
    await j(`/v1/sleeves/${ai.id}/perceive`, {
      method: 'POST', body: JSON.stringify({ input: `Inference #${i}: P(coherent | tick) = 0.${90 - i}` }),
    });
  }

  console.log('▸ syncing both sleeves…');
  await j(`/v1/sleeves/${human.id}/sync`, { method: 'POST' });
  await j(`/v1/sleeves/${ai.id}/sync`, { method: 'POST' });

  console.log('▸ recalling depth=8…');
  const recall = await j(`/v1/stacks/${stack.id}/recall?depth=8`);
  console.log('  fidelity:', recall.fidelity, 'fragments:', recall.fragments.length, 'broken:', recall.broken.length);

  console.log('▸ needlecast human → ai (re-sleeving inbound)…');
  const cast = await j('/v1/needlecast', {
    method: 'POST', body: JSON.stringify({ from: human.id, to: ai.id }),
  });
  console.log('  saga:', cast.sagaId, 'shards:', cast.shards);

  console.log('▸ epoch + tokens…');
  console.log('  epoch:', await j('/v1/epochs/current'));
  console.log('  bal:  ', await j(`/v1/tokens/balances/${stack.id}`));

  console.log('▸ residues:');
  console.log(' ', await j('/v1/coordination/residues'));

  console.log('\n✓ demo complete. WebSocket fanout: ws://localhost:7070/ws');
}

main().catch((e) => { console.error('✗ demo failed:', e); process.exit(1); });
