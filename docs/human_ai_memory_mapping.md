# Human ↔ AI Memory Mapping

ECCA Stack does not treat human and AI sleeves as fundamentally different. Both are *processes that perceive, write episodic nodes, accrue drift, and synchronize*. The mapping is parametric.

| Concept | Human sleeve | AI sleeve |
|---|---|---|
| Perception unit | Lived experience (sentence) | Inference output (token sequence) |
| Tick rate | 8 s (slow narrative) | 2 s (fast inference) |
| Compute consumption | 0.5 / tick | 5–50 / tick (LLM-bound) |
| Memory pin policy | Emotion-weighted (heuristic) | Salience-weighted (attention) |
| Drift recovery | Human reflection (manual sync) | LLM rehearsal (auto-sync at threshold) |
| Failure mode | Confabulation (recall fidelity < 0.6) | Hallucination (same — reads broken DAG) |

Both kinds write to the *same* hippocampus DAG; both decrypt with the *same* per-epoch key. **A Stack can carry both a human and an AI sleeve simultaneously**, sharing memory — this is the architectural core of the *Altered Carbon* premise.

## Co-resident Sleeves

When `n` sleeves are co-resident on a stack, only one (the *primary*) advances `episodicHead`. Others run in **shadow mode**: they perceive into ephemeral DAG branches that are merged at sync time via the memory-reconciler worker. Conflicts are reified as `coordination.residue.detected` of kind `speculative-divergence`.

## Privacy & Asymmetric Recall

A Stack owner can grant scoped recall keys (a partial HKDF) to a subset of epochs — e.g. a human sleeve can read its AI-twin's reasoning of last week without granting access to today's confidential session.

See [sleeve_model.md](sleeve_model.md), [dhf_overview.md](dhf_overview.md).
