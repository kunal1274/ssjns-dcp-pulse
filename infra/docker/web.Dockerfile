# DCP Pulse web (static Vite build served by nginx). Build context: repository root.
FROM node:22.23.5-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @dcp/web... --filter dcp-pulse
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @dcp/shared build && pnpm --filter @dcp/web build

FROM nginx:1.27-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
