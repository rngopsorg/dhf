#!/usr/bin/env bash
# Build the orchestrator image.
set -euo pipefail

: "${PLAYFAIR_DIR:?PLAYFAIR_DIR required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

docker build -t "ecca-playfair-orchestrator:${IMAGE_TAG}" \
  -f "${PLAYFAIR_DIR}/Dockerfile.orchestrator" "${PLAYFAIR_DIR}"
echo "✓ ecca-playfair-orchestrator:${IMAGE_TAG} built"
