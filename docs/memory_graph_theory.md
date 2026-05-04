# Memory Graph Theory

The DHF is formally a **directed acyclic graph** $G = (V, E)$ where:

- $V$ = set of memory nodes, each carrying $(cid, epoch, kind, pinned)$
- $E \subset V \times V$ = parent links; if $(u, v) \in E$ then $u.epoch \le v.epoch$
- The Stack's `episodicHead` is the unique source of an outbound traversal ordering

## Properties

**Property 1 — Monotone Epochs.**  $\forall (u, v) \in E:\ u.epoch \ge v.epoch$ (newer points to older). This makes traversal a chronological walk into the past.

**Property 2 — Pin-Bounded Recoverability.**  A node $v$ is *recoverable from epoch $e$* iff $|e - v.epoch| \le \text{align}$ or $v.pinned$. The pinned subgraph $G_P \subseteq G$ is the **long-term memory**.

**Property 3 — Token-Bounded Depth.**  Reconstruction from a sleeve $s$ visits at most $\min(\text{requested}, s.\text{tokens.memory})$ nodes. This makes recall *economically* bounded — perfect total recall costs unbounded `MemoryToken`.

**Property 4 — Fidelity Decay.**  Define $\phi(e, v) = e^{-\alpha (e - v.epoch)}$ for non-pinned $v$. The expected fidelity of a depth-$d$ recall is

$$
\mathbb{E}[\text{fidelity}] = \frac{1}{d} \sum_{i=1}^{d} \phi(e, v_i).
$$

For $\alpha = 0.05$ and a 32-node walk over 100 epochs, $\mathbb{E}[\text{fidelity}] \approx 0.61$, matching the `FIDELITY_MIN_DEFAULT = 0.6` threshold.

## Pruning

The hippocampus retains only nodes satisfying:

$$
v.pinned \ \lor\ (e_{\text{tip}} - v.epoch) \le \text{retention} \ \lor\ \exists\,u: u.pinned \land (u, v) \in E^*
$$

i.e. a node survives if it is pinned, recent, or transitively reachable from a pinned ancestor. Everything else is forgotten — by design.

See [dhf_overview.md](dhf_overview.md), [failure_modes.md](failure_modes.md).
