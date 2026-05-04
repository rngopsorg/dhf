// Event taxonomy for the axonal-bus (NATS JetStream).
// Every cross-service event is typed via these schemas.

import { z } from 'zod';

export const StackId = z.string().regex(/^stack:[a-z]+:\d+:[0-9a-f]+$/);
export const SleeveId = z.string().regex(/^sleeve:[a-z]+:\d+:[0-9a-f]+$/);
export const Cid = z.string().regex(/^ecca:\/\/[0-9a-f]{64}(@\d+)?$/);

export const EmbodimentType = z.enum(['human', 'ai', 'mining', 'memory']);
export type EmbodimentType = z.infer<typeof EmbodimentType>;

// ─── Lifecycle events ───────────────────────────────────────────────────────
export const StackCreated = z.object({
  type: z.literal('stack.created'),
  stackId: StackId, name: z.string(), kind: z.string(),
  tokenId: z.number().int(), pubkey: z.string(),
  ts: z.number(),
});
export const SleeveSpawned = z.object({
  type: z.literal('sleeve.spawned'),
  sleeveId: SleeveId, stackId: StackId, embodimentType: EmbodimentType,
  ts: z.number(),
});
export const SleeveDecommissioned = z.object({
  type: z.literal('sleeve.decommissioned'),
  sleeveId: SleeveId, stackId: StackId, ts: z.number(),
});

// ─── Cognition events ───────────────────────────────────────────────────────
export const PerceiveEvent = z.object({
  type: z.literal('sleeve.perceive'),
  sleeveId: SleeveId, stackId: StackId, cid: Cid,
  computeCost: z.number(), ts: z.number(),
});
export const RecallEvent = z.object({
  type: z.literal('memory.recall'),
  stackId: StackId, sleeveId: SleeveId.optional(),
  rootCid: Cid, fidelity: z.number().min(0).max(1),
  fragments: z.number().int(), broken: z.number().int(),
  ts: z.number(),
});

// ─── Synchronization events ─────────────────────────────────────────────────
export const NeedlecastEvent = z.object({
  type: z.literal('needlecast'),
  stackId: StackId, fromSleeve: SleeveId, toSleeve: SleeveId,
  merkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  epoch: z.number().int().nonnegative(),
  fidelity: z.number(),
  ts: z.number(),
});
export const DriftEvent = z.object({
  type: z.literal('sleeve.drift'),
  sleeveId: SleeveId, stackId: StackId,
  drift: z.number(), threshold: z.number(),
  ts: z.number(),
});
export const DesyncEvent = z.object({
  type: z.literal('cross-chain.desync'),
  stackId: StackId.optional(),
  sleeves: z.array(z.object({ sleeveId: SleeveId, drift: z.number() })),
  ts: z.number(),
});

// ─── Coordination Residue Events (CREs) ─────────────────────────────────────
export const ResidueKind = z.enum([
  'stale-ordering',           // high routing + low sync
  'speculative-divergence',   // high compute + low memory
  'historical-non-canonical', // high memory + low sync
  'reorg-orphan',             // medulla-pow reorg crossed an anchor
  'shard-loss',               // pinned shard evicted
]);

/** Plain enum companion for non-zod consumers (e.g. ResidueKindEnum.StaleOrdering) */
export const ResidueKindEnum = {
  StaleOrdering: 'stale-ordering',
  SpeculativeDivergence: 'speculative-divergence',
  HistoricalNonCanonical: 'historical-non-canonical',
  ReorgOrphan: 'reorg-orphan',
  ShardLoss: 'shard-loss',
} as const;
export const ResidueDetected = z.object({
  type: z.literal('residue.detected'),
  residueId: z.string(),
  kind: ResidueKind,
  stackId: StackId.optional(),
  evidence: z.record(z.unknown()),
  bountyEstimate: z.number(),
  ts: z.number(),
});
export const ResidueResolved = z.object({
  type: z.literal('residue.resolved'),
  residueId: z.string(),
  resolverStack: StackId,
  proofTxHash: z.string(),
  payout: z.number(),
  ts: z.number(),
});

// ─── Epoch / chain events ───────────────────────────────────────────────────
export const EpochTransition = z.object({
  type: z.literal('epoch.transition'),
  epoch: z.number().int().nonnegative(),
  blockHash: z.string(), crossRoot: z.string(),
  evmRoot: z.string(), ipfsRoot: z.string(), sleevesRoot: z.string(),
  difficulty: z.number(), ts: z.number(),
});
export const CoordinationTick = z.object({
  type: z.literal('coordination.tick'),
  crossRoot: z.string(),
  chains: z.object({ evm: z.string(), btc: z.string(), ipfs: z.string(), sleeves: z.string() }),
  ts: z.number(),
});

export const EccaEvent = z.discriminatedUnion('type', [
  StackCreated, SleeveSpawned, SleeveDecommissioned,
  PerceiveEvent, RecallEvent,
  NeedlecastEvent, DriftEvent, DesyncEvent,
  ResidueDetected, ResidueResolved,
  EpochTransition, CoordinationTick,
]);
export type EccaEvent = z.infer<typeof EccaEvent>;

/** NATS subject conventions */
export const SUBJECTS = {
  stacks:        'ecca.stacks.>',
  sleeves:       'ecca.sleeves.>',
  needlecast:    'ecca.needlecast.>',
  memory:        'ecca.memory.>',
  residue:       'ecca.residue.>',
  epoch:         'ecca.epoch.>',
  coordination:  'ecca.coordination.>',
} as const;

export const STREAM_CONFIG = {
  name: 'ECCA',
  subjects: ['ecca.>'],
  retention: 'limits',
  max_msgs: 1_000_000,
  max_age_ns: 7 * 24 * 60 * 60 * 1e9, // 7d
} as const;
