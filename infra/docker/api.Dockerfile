# DCP Pulse API (NestJS). Build context: repository root.
FROM node:22.23.5-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @dcp/api... --filter dcp-pulse
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @dcp/shared build && pnpm --filter @dcp/api build

# Runtime keeps the workspace layout so the Prisma CLI, migrations and seed
# scripts are available to the one-shot `migrate` service as well as the API.
FROM build AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
