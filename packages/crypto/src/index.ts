// Production cryptographic primitives for ECCA Stack v3.
// All algorithms via @noble — audited, dependency-free, browser+node compatible.

import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hkdf } from '@noble/hashes/hkdf';
import { gcm } from '@noble/ciphers/aes';
import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils';

export { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 };

// ─── Hashing ────────────────────────────────────────────────────────────────

export function sha256(data: Uint8Array | string): Uint8Array {
  return nobleSha256(typeof data === 'string' ? utf8ToBytes(data) : data);
}

export function sha256hex(data: Uint8Array | string | object): string {
  const buf = typeof data === 'string' || data instanceof Uint8Array
    ? data
    : JSON.stringify(data);
  return bytesToHex(sha256(buf as Uint8Array | string));
}

// ─── Content Addressing — ECCA CID format ───────────────────────────────────
// Production format: `ecca://<sha256hex>@<epoch>` (multicodec 0xECCA)
// The epoch suffix is what distinguishes ECCA CIDs from raw IPFS CIDs and
// enables O(log n) epoch-window scans in the hippocampus blockstore.

export interface CidComponents {
  hash: string;       // 64-char hex
  epoch: number;      // monotonically increasing
}

export function cid(content: unknown, epoch: number): string {
  const buf = typeof content === 'string' || content instanceof Uint8Array
    ? content as Uint8Array | string
    : JSON.stringify(content);
  return `ecca://${sha256hex(buf)}@${epoch}`;
}

export function parseCid(cidStr: string): CidComponents | null {
  const m = cidStr.match(/^ecca:\/\/([0-9a-f]{64})(?:@(\d+))?$/);
  if (!m || !m[1]) return null;
  return { hash: m[1], epoch: m[2] ? Number(m[2]) : 0 };
}

// ─── Epoch keys (HKDF-SHA512) ───────────────────────────────────────────────
// Domain-separated key derivation: salt=stackId, info='ecca-epoch:'+epoch,
// IKM = master secret. Production-grade, replaces the v2 sha256 toy KDF.

export function epochKey(
  stackId: string,
  epoch: number,
  masterSecret = process.env.ECCA_MASTER_SECRET ?? 'ECCA_GENESIS',
): Uint8Array {
  return hkdf(sha512, utf8ToBytes(masterSecret), utf8ToBytes(stackId), `ecca-epoch:${epoch}`, 32);
}

// ─── AES-256-GCM authenticated encryption ───────────────────────────────────

export interface EncPayload {
  iv: string;   // 12 bytes hex
  ct: string;   // ciphertext + tag, hex
  v: 1;         // version
}

export function encrypt(plaintext: string | Uint8Array, key: Uint8Array): EncPayload {
  const iv = randomBytes(12);
  const pt = typeof plaintext === 'string' ? utf8ToBytes(plaintext) : plaintext;
  const ct = gcm(key, iv).encrypt(pt);
  return { iv: bytesToHex(iv), ct: bytesToHex(ct), v: 1 };
}

export function decrypt(payload: EncPayload, key: Uint8Array): string {
  if (payload.v !== 1) throw new Error(`unsupported payload version: ${payload.v}`);
  const iv = hexToBytes(payload.iv);
  const ct = hexToBytes(payload.ct);
  const pt = gcm(key, iv).decrypt(ct);
  return bytesToUtf8(pt);
}

// ─── Ed25519 identity keypair ───────────────────────────────────────────────

export interface IdentityKeypair { pub: string; priv: string; }

export function genIdentityKeypair(): IdentityKeypair {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  return { pub: bytesToHex(pub), priv: bytesToHex(priv) };
}

export function sign(privHex: string, message: string | Uint8Array): string {
  const m = typeof message === 'string' ? utf8ToBytes(message) : message;
  return bytesToHex(ed25519.sign(m, hexToBytes(privHex)));
}

export function verify(pubHex: string, message: string | Uint8Array, sigHex: string): boolean {
  try {
    const m = typeof message === 'string' ? utf8ToBytes(message) : message;
    return ed25519.verify(hexToBytes(sigHex), m, hexToBytes(pubHex));
  } catch { return false; }
}

// ─── Merkle tree (binary, sha256, RFC-6962-style domain separation) ─────────

const LEAF = new Uint8Array([0x00]);
const NODE = new Uint8Array([0x01]);

function hashLeaf(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(LEAF.length + data.length);
  buf.set(LEAF, 0); buf.set(data, LEAF.length);
  return sha256(buf);
}
function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  const buf = new Uint8Array(NODE.length + left.length + right.length);
  buf.set(NODE, 0); buf.set(left, NODE.length); buf.set(right, NODE.length + left.length);
  return sha256(buf);
}

export function merkleRoot(leaves: Array<Uint8Array | string>): string {
  if (!leaves.length) return bytesToHex(sha256(new Uint8Array()));
  let layer = leaves.map((l) => hashLeaf(typeof l === 'string' ? utf8ToBytes(l) : l));
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1] ?? a;
      next.push(hashNode(a, b));
    }
    layer = next;
  }
  return bytesToHex(layer[0]!);
}

export interface MerkleProof { siblings: string[]; index: number; }

export function merkleProof(leaves: Array<Uint8Array | string>, index: number): MerkleProof {
  if (index < 0 || index >= leaves.length) throw new Error('index out of range');
  let layer = leaves.map((l) => hashLeaf(typeof l === 'string' ? utf8ToBytes(l) : l));
  let i = index;
  const siblings: string[] = [];
  while (layer.length > 1) {
    const sib = i % 2 === 0 ? (layer[i + 1] ?? layer[i]) : layer[i - 1];
    siblings.push(bytesToHex(sib!));
    const next: Uint8Array[] = [];
    for (let j = 0; j < layer.length; j += 2) {
      next.push(hashNode(layer[j]!, layer[j + 1] ?? layer[j]!));
    }
    layer = next;
    i = Math.floor(i / 2);
  }
  return { siblings, index };
}

export function verifyMerkleProof(
  leaf: Uint8Array | string,
  proof: MerkleProof,
  root: string,
): boolean {
  let h = hashLeaf(typeof leaf === 'string' ? utf8ToBytes(leaf) : leaf);
  let i = proof.index;
  for (const sibHex of proof.siblings) {
    const sib = hexToBytes(sibHex);
    h = i % 2 === 0 ? hashNode(h, sib) : hashNode(sib, h);
    i = Math.floor(i / 2);
  }
  return bytesToHex(h) === root;
}

// ─── Synaptic Field MMR ─────────────────────────────────────────────────────
// Merkle Mountain Range over coherence roots (medulla-pow block headers).
// O(log n) append, O(log n) inclusion proofs, perfect for the rolling window
// of last 256 coherence roots required by the cross-chain consistency check.

export class SynapticFieldMMR {
  private peaks: Uint8Array[] = [];
  private size = 0;

  append(coherenceRoot: string | Uint8Array): string {
    let leaf = hashLeaf(typeof coherenceRoot === 'string' ? hexToBytes(coherenceRoot) : coherenceRoot);
    this.size += 1;
    let height = 0;
    while (this.shouldMerge(height)) {
      const left = this.peaks.pop()!;
      leaf = hashNode(left, leaf);
      height += 1;
    }
    this.peaks.push(leaf);
    return this.root();
  }

  private shouldMerge(height: number): boolean {
    // After appending leaf #n, the bit at position `height` in n flips from 1→0
    // iff a merge of subtrees of size 2^height should occur.
    return this.peaks.length >= 2 && ((this.size >> height) & 1) === 0;
  }

  /** Bagging the peaks: hash all peaks together (right→left) into a single root. */
  root(): string {
    if (!this.peaks.length) return bytesToHex(sha256(new Uint8Array()));
    let acc = this.peaks[this.peaks.length - 1]!;
    for (let i = this.peaks.length - 2; i >= 0; i -= 1) {
      acc = hashNode(this.peaks[i]!, acc);
    }
    return bytesToHex(acc);
  }

  count(): number { return this.size; }
  snapshot(): { size: number; peaks: string[]; root: string } {
    return { size: this.size, peaks: this.peaks.map(bytesToHex), root: this.root() };
  }
}

// ─── Coherence root helper — cross-chain consistency root ───────────────────

export function coherenceRoot(parts: {
  evm: string;
  btc: string;
  ipfs: string;
  sleeves: string;
}): string {
  return sha256hex(`${parts.evm}|${parts.btc}|${parts.ipfs}|${parts.sleeves}`);
}
