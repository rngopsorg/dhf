#!/usr/bin/env bash
# Label k3d agent nodes with ecca.io/region=<region>
# Inputs (env): REGIONS (comma-separated)
set -euo pipefail

: "${REGIONS:?REGIONS required}"

IFS=',' read -ra REGION_ARRAY <<< "$REGIONS"

# Get agent nodes (exclude control-plane). Use a read-loop instead of mapfile
# because macOS ships bash 3.2 which does not have mapfile.
AGENTS=()
while IFS= read -r line; do
  [ -n "$line" ] && AGENTS+=("$line")
done < <(kubectl get nodes \
  --selector='!node-role.kubernetes.io/control-plane' \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')

if [ "${#AGENTS[@]}" -lt "${#REGION_ARRAY[@]}" ]; then
  echo "ERROR: only ${#AGENTS[@]} agent nodes, need ${#REGION_ARRAY[@]}" >&2
  exit 1
fi

for i in "${!REGION_ARRAY[@]}"; do
  kubectl label node "${AGENTS[$i]}" \
    "ecca.io/region=${REGION_ARRAY[$i]}" \
    --overwrite >/dev/null
  echo "✓ Labeled ${AGENTS[$i]} → ${REGION_ARRAY[$i]}"
done
