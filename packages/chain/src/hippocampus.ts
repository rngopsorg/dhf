// Hippocampus DAG client — talks to the patched kubo-fork over its HTTP API.
// All requests carry an explicit (stackId, epoch, memoryToken) gate so the
// hippocampus can refuse retrieval at the protocol layer.

import { request } from 'undici';

export interface HippoPutInput {
  stackId: string;
  epoch: number;
  ciphertext: { iv: string; ct: string; v: 1 };
  links: string[];
  kind: 'episodic' | 'semantic' | 'needlecast-shard';
  pinned?: boolean;
}
export interface HippoNode {
  cid: string;
  ciphertext: { iv: string; ct: string; v: 1 };
  links: string[];
  epoch: number;
  kind: string;
  pinned: boolean;
  stackId: string;
}

const BASE = process.env.HIPPOCAMPUS_API ?? 'http://hippocampus-dag:5001';

export class HippocampusClient {
  constructor(private readonly base: string = BASE) {}

  async put(input: HippoPutInput): Promise<{ cid: string }> {
    const r = await request(`${this.base}/dag/put`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (r.statusCode >= 400) throw new Error(`put failed: ${r.statusCode} ${await r.body.text()}`);
    return (await r.body.json()) as { cid: string };
  }

  async get(cid: string): Promise<HippoNode | null> {
    const r = await request(`${this.base}/dag/get?cid=${encodeURIComponent(cid)}`);
    if (r.statusCode === 404) return null;
    if (r.statusCode >= 400) throw new Error(`get failed: ${r.statusCode}`);
    return (await r.body.json()) as HippoNode;
  }

  async pin(cid: string): Promise<void> {
    const r = await request(`${this.base}/pin/add?cid=${encodeURIComponent(cid)}`, { method: 'POST' });
    if (r.statusCode >= 400) throw new Error(`pin failed: ${r.statusCode}`);
  }

  /**
   * Token-gated traversal performed entirely server-side. The hippocampus
   * verifies (epoch, memoryToken) against on-chain balances before walking.
   */
  async recall(args: {
    rootCid: string; stackId: string; epoch: number; depth: number; memoryToken: number;
  }): Promise<{ fragments: HippoNode[]; broken: string[]; fidelity: number }> {
    const r = await request(`${this.base}/dhf/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (r.statusCode >= 400) throw new Error(`recall failed: ${r.statusCode} ${await r.body.text()}`);
    return (await r.body.json()) as { fragments: HippoNode[]; broken: string[]; fidelity: number };
  }

  async snapshot(): Promise<{ nodes: number; pinned: number; peers: number }> {
    const r = await request(`${this.base}/stat`);
    return (await r.body.json()) as any;
  }
}
