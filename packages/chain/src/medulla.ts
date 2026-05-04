// Medulla PoW client — talks to the patched btcd-fork JSON-RPC.
import { request } from 'undici';

const BASE = process.env.MEDULLA_RPC ?? 'http://medulla-pow:8332';

export interface CoherenceAnchor {
  blockHash: string;
  height: number;
  epoch: number;
  crossRoot: string;
  evmRoot: string; ipfsRoot: string; sleevesRoot: string;
  synapticFieldRoot: string;
  ts: number;
}

export class MedullaClient {
  constructor(private readonly base: string = BASE) {}

  private async rpc<T>(method: string, params: unknown = {}): Promise<T> {
    const r = await request(`${this.base}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    const body = (await r.body.json()) as any;
    if (body.error) throw new Error(`medulla rpc ${method}: ${body.error.message ?? body.error}`);
    return body.result as T;
  }

  getInfo() { return this.rpc<{ height: number; difficulty: number; tip: string; epoch: number }>('getinfo'); }
  getEpochAnchor(epoch: number) { return this.rpc<CoherenceAnchor>('getepochanchor', { epoch }); }
  getLatestAnchor() { return this.rpc<CoherenceAnchor>('getlatestanchor'); }
  submitCoherenceRoot(args: { crossRoot: string; evmRoot: string; ipfsRoot: string; sleevesRoot: string }) {
    return this.rpc<{ height: number; blockHash: string; epoch: number }>('submitcoherenceroot', args);
  }
  getSynapticProof(blockHash: string) {
    return this.rpc<{ siblings: string[]; index: number; root: string }>('getsynapticproof', { blockHash });
  }
  joinPool(args: { sleeveId: string; pool: string }) { return this.rpc<{ ok: boolean }>('joinpool', args); }
  mineBlock(pool = 'genesis-pool') { return this.rpc<CoherenceAnchor>('mineblock', { pool }); }
}
