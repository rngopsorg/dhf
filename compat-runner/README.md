# compat-runner

Replays v2 simulation vectors against v3 to validate behavioral parity.
Mount your v2 vector directory at `/vectors` and run:

```bash
pnpm --filter @ecca/compat-runner compat
```

Each vector is a JSON object describing `{ inputs, expected }` for one of the v2 deterministic primitives (`spawn`, `perceive`, `recall`, `needlecast`, `epochTick`). The runner replays inputs against the v3 synapse-api and asserts structural equivalence on the response shape (epoch-relative state cannot be byte-equal due to fresh keys).
