// Token taxonomy — bound to StackIdentity NFT, interpreted across all subsystems.
// See docs/token_economy.md.

import { z } from 'zod';

/** Five cognitive-economic tokens. Not currency — control variables. */
export const TokenKind = z.enum([
  'compute',  // execution bandwidth (cortex-evm, sleeve-runtime-ai, dhf-compositor)
  'memory',   // reconstruction depth (hippocampus-dag, memory-reconciler, needlecast-router)
  'sync',     // temporal coherence  (medulla-pow, epoch-anchor, thalamus-router)
  'routing',  // information visibility (axonal-bus, hippocampus-dag, siyana-api)
  'residue',  // coordination repair  (residue-collector, thalamus-router, memory-reconciler)
]);
export type TokenKind = z.infer<typeof TokenKind>;

export const TOKEN_CONTRACT_NAMES: Record<TokenKind, string> = {
  compute: 'ComputeToken',
  memory:  'MemoryToken',
  sync:    'SyncToken',
  routing: 'RoutingToken',
  residue: 'ResidueToken',
};

/** Coherence Profile Vector — per-stack token interaction coefficients. */
export const CoherenceProfileVector = z.object({
  computeCoeff: z.number().min(0).max(2).default(1),
  memoryCoeff:  z.number().min(0).max(2).default(1),
  syncCoeff:    z.number().min(0).max(2).default(1),
  routingCoeff: z.number().min(0).max(2).default(1),
  residueCoeff: z.number().min(0).max(2).default(1),
});
export type CoherenceProfileVector = z.infer<typeof CoherenceProfileVector>;

/** Per-stack epoch binding — modifies token effects over time. */
export const EpochBindingCurve = z.object({
  // f(epoch_delta) = base * exp(-decayRate * epoch_delta)
  decayRate: z.number().min(0).max(1).default(0.05),
  // Hard floor — tokens never decay below this fraction of nominal.
  floor: z.number().min(0).max(1).default(0.25),
});
export type EpochBindingCurve = z.infer<typeof EpochBindingCurve>;

export const TokenBalance = z.object({
  compute: z.number().nonnegative(),
  memory:  z.number().nonnegative(),
  sync:    z.number().nonnegative(),
  routing: z.number().nonnegative(),
  residue: z.number().nonnegative(),
});
export type TokenBalance = z.infer<typeof TokenBalance>;

export const DEFAULT_BALANCE: TokenBalance = {
  compute: 1000, memory: 1000, sync: 1000, routing: 1000, residue: 0,
};

/**
 * Apply CPV + epoch binding to a raw balance to produce the effective
 * bandwidth available to a stack at a given epoch delta from issuance.
 */
export function effectiveBalance(
  raw: TokenBalance,
  cpv: CoherenceProfileVector,
  curve: EpochBindingCurve,
  epochDelta: number,
): TokenBalance {
  const decay = Math.max(curve.floor, Math.exp(-curve.decayRate * Math.max(0, epochDelta)));
  return {
    compute: raw.compute * cpv.computeCoeff * decay,
    memory:  raw.memory  * cpv.memoryCoeff  * decay,
    sync:    raw.sync    * cpv.syncCoeff    * decay,
    routing: raw.routing * cpv.routingCoeff * decay,
    residue: raw.residue * cpv.residueCoeff,    // residue does not decay — repair must remain incentivized
  };
}
