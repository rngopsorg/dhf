FROM node:20-alpine AS ts-builder

WORKDIR /app

# System deps for native modules + prisma + make
RUN apk add --no-cache python3 make g++ git bash openssl

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

# Copy entire monorepo (respects .dockerignore)
COPY . .

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Build all TypeScript packages via turbo
RUN pnpm build

# Run contract tests
RUN cd contracts && npx hardhat test

# ─────────────────────────────────────────────────────────────────────────────
# Go builds — medulla-pow and hippocampus-dag
# ─────────────────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS medulla-builder

WORKDIR /src
RUN apk add --no-cache git
COPY forks/medulla-pow-go/ .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/medullad ./cmd/medullad
RUN go vet ./...

FROM golang:1.22-alpine AS hippocampus-builder

WORKDIR /src
RUN apk add --no-cache git
COPY forks/hippocampus-dag-go/ .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/hippod ./cmd/hippod
RUN go vet ./...

# ─────────────────────────────────────────────────────────────────────────────
# Cortex EVM — validate genesis.json is well-formed
# ─────────────────────────────────────────────────────────────────────────────
FROM ethereum/client-go:v1.14.8 AS cortex-validator

COPY forks/cortex-evm-go/genesis /genesis
RUN geth init --datadir /tmp/cortex-test /genesis/genesis.json

# ─────────────────────────────────────────────────────────────────────────────
# Final verification stage — assemble all artifacts, prove everything built
# ─────────────────────────────────────────────────────────────────────────────
FROM alpine:3.20 AS final

RUN apk add --no-cache bash file

# Copy TS build artifacts
COPY --from=ts-builder /app/packages/proto/dist /artifacts/ts/packages/proto/dist
COPY --from=ts-builder /app/packages/crypto/dist /artifacts/ts/packages/crypto/dist
COPY --from=ts-builder /app/packages/bus/dist /artifacts/ts/packages/bus/dist
COPY --from=ts-builder /app/packages/db/dist /artifacts/ts/packages/db/dist
COPY --from=ts-builder /app/packages/chain/dist /artifacts/ts/packages/chain/dist
COPY --from=ts-builder /app/packages/service-base/dist /artifacts/ts/packages/service-base/dist
COPY --from=ts-builder /app/services/siyana-api/dist /artifacts/ts/services/siyana-api/dist
COPY --from=ts-builder /app/services/thalamus-router/dist /artifacts/ts/services/thalamus-router/dist
COPY --from=ts-builder /app/services/dhf-compositor/dist /artifacts/ts/services/dhf-compositor/dist
COPY --from=ts-builder /app/services/needlecast-router-svc/dist /artifacts/ts/services/needlecast-router-svc/dist
COPY --from=ts-builder /app/services/quellist-treasury-svc/dist /artifacts/ts/services/quellist-treasury-svc/dist
COPY --from=ts-builder /app/services/bandwidth-faucet/dist /artifacts/ts/services/bandwidth-faucet/dist
COPY --from=ts-builder /app/services/sleeve-runtime/dist /artifacts/ts/services/sleeve-runtime/dist
COPY --from=ts-builder /app/workers/runner/dist /artifacts/ts/workers/runner/dist
COPY --from=ts-builder /app/contracts/artifacts /artifacts/ts/contracts/artifacts

# Copy Go binaries
COPY --from=medulla-builder /out/medullad /artifacts/go/medullad
COPY --from=hippocampus-builder /out/hippod /artifacts/go/hippod

# Copy cortex genesis validation proof
COPY --from=cortex-validator /tmp/cortex-test/geth /artifacts/cortex-evm-validated

# Verify all artifacts exist
RUN echo "=== BUILD VERIFICATION ===" && \
    echo "--- TypeScript packages ---" && \
    ls /artifacts/ts/packages/proto/dist/index.js && \
    ls /artifacts/ts/packages/crypto/dist/index.js && \
    ls /artifacts/ts/packages/bus/dist/index.js && \
    ls /artifacts/ts/packages/db/dist/index.js && \
    ls /artifacts/ts/packages/chain/dist/index.js && \
    ls /artifacts/ts/packages/service-base/dist/index.js && \
    echo "--- TypeScript services ---" && \
    ls /artifacts/ts/services/siyana-api/dist/server.js && \
    ls /artifacts/ts/services/thalamus-router/dist/server.js && \
    ls /artifacts/ts/services/dhf-compositor/dist/server.js && \
    ls /artifacts/ts/services/needlecast-router-svc/dist/server.js && \
    ls /artifacts/ts/services/quellist-treasury-svc/dist/server.js && \
    ls /artifacts/ts/services/bandwidth-faucet/dist/server.js && \
    ls /artifacts/ts/services/sleeve-runtime/dist/server.js && \
    ls /artifacts/ts/workers/runner/dist/server.js && \
    echo "--- Solidity contracts ---" && \
    ls /artifacts/ts/contracts/artifacts/src && \
    echo "--- Go binaries ---" && \
    file /artifacts/go/medullad && \
    file /artifacts/go/hippod && \
    echo "--- Cortex EVM genesis ---" && \
    ls /artifacts/cortex-evm-validated && \
    echo "" && \
    echo "✓ ALL BUILDS VERIFIED SUCCESSFULLY"

CMD ["echo", "All builds passed."]
