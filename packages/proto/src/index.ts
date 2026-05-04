export * from './tokens.js';
export * from './events.js';

/** System-wide constants */
export const ECCA = {
  CID_PREFIX: 'ecca://',
  MULTICODEC: 0xECCA,
  CORTEX_CHAIN_ID: 131072,
  GENESIS_DIFFICULTY: 4,
  SYNAPTIC_FIELD_DEPTH: 256,   // medulla-pow MMR depth (last N coherence roots)
  EPOCH_INTERVAL_MS: 4_000,
  DRIFT_MAX_DEFAULT: 15,
  FIDELITY_MIN_DEFAULT: 0.6,
  /** Token addresses are deterministic via CREATE2 — published in deployments.json */
} as const;

/** Continuity invariant: a stack is continuous iff fidelity ≥ min and drift ≤ max. */
export interface ContinuityCheck {
  stackId: string;
  continuous: boolean;
  fidelity: number;
  maxDrift: number;
  sleeveCount: number;
}
