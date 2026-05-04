FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git python3 make g++
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY contracts ./contracts
RUN pnpm install --no-frozen-lockfile
RUN cd contracts && pnpm hardhat compile
WORKDIR /app/contracts
CMD ["pnpm", "run", "deploy:local"]
