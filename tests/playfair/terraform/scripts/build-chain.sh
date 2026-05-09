#!/usr/bin/env bash
# Build a Go chain image. $1 = chain name (medulla-pow | hippocampus-dag | cortex-evm)
set -euo pipefail

CHAIN="${1:?chain name required}"
: "${REPO_ROOT:?REPO_ROOT required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

cd "$REPO_ROOT"
docker build -t "ecca-${CHAIN}:${IMAGE_TAG}" -f "forks/${CHAIN}-go/Dockerfile" "forks/${CHAIN}-go/"
echo "✓ ecca-${CHAIN}:${IMAGE_TAG} built"
