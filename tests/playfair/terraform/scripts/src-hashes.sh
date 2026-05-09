#!/usr/bin/env bash
# Compute SHA-256 hashes of source trees that drive image rebuilds.
# Terraform external data source protocol:
#   - reads a JSON object from stdin
#   - emits a flat JSON object of string→string on stdout
set -euo pipefail

QUERY=$(cat)
REPO_ROOT=$(echo "$QUERY" | sed -n 's/.*"repo_root"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT" ]; then
  echo "{\"error\": \"repo_root not a directory: $REPO_ROOT\"}"
  exit 1
fi

cd "$REPO_ROOT"

# Hash a list of paths together. Skips non-existent paths.
# Ignores node_modules / dist / .git / .turbo / artifacts.
hash_paths() {
  local existing=()
  for p in "$@"; do
    [ -e "$p" ] && existing+=("$p")
  done
  if [ "${#existing[@]}" -eq 0 ]; then
    echo "missing"
    return
  fi
  find "${existing[@]}" \
    \( -name node_modules -o -name dist -o -name .git -o -name target -o -name .turbo -o -name artifacts -o -name cache \) -prune -o \
    -type f -print 2>/dev/null \
    | LC_ALL=C sort \
    | tr '\n' '\0' \
    | xargs -0 shasum -a 256 2>/dev/null \
    | shasum -a 256 \
    | awk '{print $1}'
}

TS_HASH=$(hash_paths packages services workers contracts Dockerfile.builder pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json)
MEDULLA_HASH=$(hash_paths forks/medulla-pow-go)
HIPPO_HASH=$(hash_paths forks/hippocampus-dag-go)
CORTEX_HASH=$(hash_paths forks/cortex-evm-go)
ORCH_HASH=$(hash_paths tests/playfair/orchestrator.js tests/playfair/Dockerfile.orchestrator)

cat <<EOF
{
  "ts_builder": "$TS_HASH",
  "chain_medulla_pow": "$MEDULLA_HASH",
  "chain_hippocampus_dag": "$HIPPO_HASH",
  "chain_cortex_evm": "$CORTEX_HASH",
  "orchestrator": "$ORCH_HASH"
}
EOF
