#!/usr/bin/env bash
# Create a k3d cluster with port mappings.
# Inputs (env): CLUSTER_NAME, AGENTS, PORTS (pipe-separated host:nodePort entries)
set -euo pipefail

: "${CLUSTER_NAME:?CLUSTER_NAME required}"
: "${AGENTS:?AGENTS required}"
: "${PORTS:?PORTS required}"

# Wipe any existing cluster of the same name (idempotent create)
k3d cluster delete "$CLUSTER_NAME" >/dev/null 2>&1 || true

# Build --port flags
PORT_FLAGS=()
IFS='|' read -ra PORT_ENTRIES <<< "$PORTS"
for p in "${PORT_ENTRIES[@]}"; do
  PORT_FLAGS+=(--port "${p}@server:0")
done

k3d cluster create "$CLUSTER_NAME" \
  --servers 1 \
  --agents "$AGENTS" \
  "${PORT_FLAGS[@]}" \
  --k3s-arg "--disable=traefik@server:0" \
  --wait

# Verify nodes are Ready
kubectl wait --for=condition=Ready nodes --all --timeout=120s
echo "✓ Cluster $CLUSTER_NAME is up with $AGENTS agents"
