#!/usr/bin/env bash
# Build a service image off the ts-builder stage.
# $1 = service name (siyana-api, thalamus-router, ..., or "worker")
set -euo pipefail

SERVICE="${1:?service name required}"
: "${REPO_ROOT:?REPO_ROOT required}"
: "${PLAYFAIR_DIR:?PLAYFAIR_DIR required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"

cd "$REPO_ROOT"

# The "worker" image uses workers/runner under /app/workers
if [ "$SERVICE" = "worker" ]; then
  IMAGE_NAME="ecca-worker:${IMAGE_TAG}"
  DOCKERFILE="${PLAYFAIR_DIR}/Dockerfile.worker"
  # Generate Dockerfile.worker on demand (one-line variant of Dockerfile.service)
  cat > "$DOCKERFILE" <<DOCKERFILE_EOF
ARG SERVICE=runner
FROM ecca-ts-builder:${IMAGE_TAG} AS builder

FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/workers/ workers/
ARG SERVICE
ENV SERVICE_NAME=\${SERVICE}
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "cd /app/workers/\${SERVICE_NAME} && node dist/server.js"]
DOCKERFILE_EOF
  docker build -t "$IMAGE_NAME" \
    --build-arg SERVICE=runner \
    -f "$DOCKERFILE" "$REPO_ROOT"
else
  docker build -t "ecca-${SERVICE}:${IMAGE_TAG}" \
    --build-arg SERVICE="$SERVICE" \
    -f "${PLAYFAIR_DIR}/Dockerfile.service" "$REPO_ROOT"
fi

echo "✓ ${SERVICE} image built"
