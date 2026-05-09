#!/usr/bin/env bash
# Build the ecca-builder + ecca-ts-builder images.
# - ecca-builder:tag is the final verification image (artifacts only)
# - ecca-ts-builder:tag is the intermediate ts-builder stage with full /app
#   monorepo (used as base for service images).
set -euo pipefail

: "${REPO_ROOT:?REPO_ROOT required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

cd "$REPO_ROOT"

docker build -t "ecca-ts-builder:${IMAGE_TAG}" \
  --target ts-builder \
  -f Dockerfile.builder .
echo "✓ ecca-ts-builder:${IMAGE_TAG} built (intermediate stage)"

docker build -t "ecca-builder:${IMAGE_TAG}" \
  -f Dockerfile.builder .
echo "✓ ecca-builder:${IMAGE_TAG} built (final stage)"
