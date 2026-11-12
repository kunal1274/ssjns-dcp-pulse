# DCP Pulse

Decentralised scheme-monitoring platform — **synthetic demonstration**, built from
_DCP Pulse Developer Specification v1.1_.

> Synthetic demonstration data. Not a government deployment and not an official
> administrative structure. No government system integrations are implemented.

## Status: F01–F03 foundation only

| Stage                          | Scope                                                                                    | State                        |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------- |
| F01 Repository and standards   | pnpm TypeScript monorepo, lint/format, CI                                                | Implemented                  |
| F02 Development environment    | Docker Compose (PostGIS, API, web, Redis; MinIO opt-in), health checks, env examples     | Implemented (MinIO see gaps) |
| F03 Core data and tenancy      | Prisma schema for the §4 model, SQL integrity/RLS migration, synthetic `ASSAM-DEMO` seed | Implemented                  |
| F04+ (auth, schemes, budgets…) | —                                                                                        | **Not implemented**          |

The web app is an engineering **status page** showing live API readiness. There are no
dashboards, KPIs, maps or business screens yet.

## Layout

```
apps/api         NestJS API (health endpoints, Pino logging, Prisma, tenant context)
  prisma/        schema.prisma, migrations/, seed/
  scripts/       bootstrap-db-roles.ts, check-migration-drift.ts
  test/          integration (migrations, seed, financial invariants, RLS) + e2e
apps/web         React + Vite + Tailwind status page
packages/shared  Shared types: permission catalogue, role templates, health contracts
infra/docker     Dockerfiles and nginx config
docs/            Architecture notes for the data layer
```

## Quick start (Docker)

```bash
cp .env.example .env          # replace every CHANGE_ME (min 12 characters)
docker compose up -d --build  # db -> migrate (roles, migrations, seed) -> api -> web
```

- Status page: http://localhost:8080
- API liveness / readiness: http://localhost:3000/api/v1/health/live, `/api/v1/health/ready`
- OpenAPI: http://localhost:3000/api/docs

The `migrate` service is idempotent: it creates the `dcp_app` runtime role, applies
migrations and seeds `ASSAM-DEMO` only if absent.

## Local development (without Docker for Node)

Requires Node 22 (`.nvmrc`), pnpm 9 and a PostgreSQL 16 + PostGIS 3 server
(`docker compose up -d db` works).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # set passwords
pnpm db:setup                            # build shared, bootstrap roles, migrate, seed
pnpm --filter @dcp/api dev               # API on :3000
pnpm --filter @dcp/web dev               # web on :5173, proxies /api to :3000
```

## Commands

| Command                 | What it does                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `pnpm lint`             | ESLint (zero warnings)                                                      |
| `pnpm format:check`     | Prettier check                                                              |
| `pnpm typecheck`        | TypeScript across all packages                                              |
| `pnpm test`             | Unit tests (shared, API, web) — no database needed                          |
| `pnpm test:integration` | Migration, seed, financial-invariant, RLS and e2e tests — needs migrated DB |
| `pnpm build`            | Build all packages                                                          |
| `pnpm db:migrate`       | `prisma migrate deploy`                                                     |
| `pnpm db:drift-check`   | Fails if migrations and `schema.prisma` disagree (temporary shadow DB)      |
| `pnpm db:seed`          | Load synthetic data (idempotent)                                            |

Integration tests read `DATABASE_URL` and `MIGRATION_DATABASE_URL` from the environment
(e.g. `set -a; . apps/api/.env; set +a`).

## Tenancy and jurisdiction design

- Every tenant-owned table has `tenant_id uuid NOT NULL`; foreign keys are composite
  `(tenant_id, x_id) -> (tenant_id, id)`, so cross-tenant references are impossible.
- PostgreSQL row-level security on every tenant table, keyed on the transaction-local
  setting `app.tenant_id`. No context means no rows. The API connects as `dcp_app`
  (not owner, no `BYPASSRLS`) and uses `PrismaService.withTenant()`.
- Jurisdictions are a configurable tree (`jurisdiction_types`, `parent_id`, trigger-maintained
  `ancestry uuid[]` with cycle prevention). Agencies are separate and linked to jurisdictions
  through `agency_jurisdictions`.

See [docs/data-layer.md](docs/data-layer.md) for financial rules and seed contents.

## Demo users

The seed creates 8 users at `*@example.test` (one per role template). Their password is
whatever you set in `SEED_DEMO_PASSWORD`; it is never committed or logged. Login is
**not implemented** until F04.

## Known gaps

- Authentication, authorisation enforcement and all business APIs (F04+) are not implemented.
  Role/permission tables and templates exist and are seeded only.
- Redis is provisioned but unused. MinIO is behind the `storage` profile because the official
  images could not be pulled from the build environment; set `MINIO_IMAGE` to an accessible image.
- Alert rules are seeded as illustrative (`is_illustrative = true`); no alert engine exists.
- Seed geography uses approximate synthetic points; no jurisdiction boundary polygons are loaded.
