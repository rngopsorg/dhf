#!/usr/bin/env bash
# Inject tc (iproute2) + required shared libs into each k3d agent node.
# k3d uses a minimal k3s image with no package manager.
# Strategy: extract tc+libs from an Alpine container → host temp → docker cp into each agent.
set -euo pipefail

: "${CLUSTER_NAME:?CLUSTER_NAME required}"

# Detect arch (Apple Silicon: aarch64, Intel: x86_64)
ARCH=$(docker run --rm alpine:3.20 uname -m)
case "$ARCH" in
  aarch64) MUSL_LD="ld-musl-aarch64.so.1" ;;
  x86_64)  MUSL_LD="ld-musl-x86_64.so.1" ;;
  *)       echo "ERROR: unsupported arch $ARCH" >&2; exit 1 ;;
esac

TC_CONTAINER="playfair-tc-extract"
docker rm -f "$TC_CONTAINER" >/dev/null 2>&1 || true

# Run alpine and install iproute2 — block until apk completes
docker run -d --name "$TC_CONTAINER" alpine:3.20 sh -c \
  "apk add --no-cache -q iproute2-tc && sleep 600" >/dev/null

# Wait for tc to appear (up to 60s)
for _i in $(seq 1 60); do
  if docker exec "$TC_CONTAINER" test -f /sbin/tc 2>/dev/null; then
    break
  fi
  sleep 1
done
docker exec "$TC_CONTAINER" test -f /sbin/tc || {
  echo "ERROR: tc never installed in alpine extract container" >&2
  docker logs "$TC_CONTAINER" >&2 || true
  exit 1
}

TC_TMP=$(mktemp -d)
trap 'rm -rf "$TC_TMP"; docker rm -f "$TC_CONTAINER" >/dev/null 2>&1 || true' EXIT

# Copy tc + dynamic linker + every shared lib via readlink-resolved real names
docker cp "${TC_CONTAINER}:/sbin/tc" "${TC_TMP}/tc"
docker cp "${TC_CONTAINER}:/lib/${MUSL_LD}" "${TC_TMP}/${MUSL_LD}"

resolve_and_copy() {
  local src_path="$1" lib_name="$2"
  local real
  real=$(docker exec "$TC_CONTAINER" readlink -f "$src_path" 2>/dev/null) || return 0
  if [ -n "$real" ]; then
    docker cp "${TC_CONTAINER}:${real}" "${TC_TMP}/${lib_name}"
  fi
}

for lib in libmnl.so.0 libxtables.so.12 libelf.so.1 libcap.so.2 libzstd.so.1; do
  resolve_and_copy "/usr/lib/${lib}" "$lib"
done
resolve_and_copy "/lib/libz.so.1" "libz.so.1"

# Inject into each k3d agent node
NODE_INDEX=0
while true; do
  NODE="k3d-${CLUSTER_NAME}-agent-${NODE_INDEX}"
  if ! docker inspect "$NODE" >/dev/null 2>&1; then
    break
  fi
  docker cp "${TC_TMP}/${MUSL_LD}" "${NODE}:/lib/${MUSL_LD}"
  docker cp "${TC_TMP}/tc"          "${NODE}:/bin/tc"
  for lib in libmnl.so.0 libxtables.so.12 libelf.so.1 libcap.so.2 libzstd.so.1 libz.so.1; do
    [ -f "${TC_TMP}/${lib}" ] && docker cp "${TC_TMP}/${lib}" "${NODE}:/lib/${lib}"
  done
  if docker exec "$NODE" tc qdisc show >/dev/null 2>&1; then
    echo "✓ tc available in $NODE"
  else
    echo "WARN: tc still not runnable in $NODE" >&2
  fi
  NODE_INDEX=$((NODE_INDEX + 1))
done
