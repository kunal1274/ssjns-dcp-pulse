# Architecture and database summary

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

## Architecture

- **Shape:** one TypeScript pnpm monorepo, deployed as a modular monolith: `apps/api` (NestJS), `apps/web`
  (React 19 + Vite, served by nginx, which also proxies `/api`), `packages/shared` (types, permission and KPI
  definitions).
- **API modules:** auth, authz, admin, schemes, budget, finance, progress, dashboards, alerts, reports,
  integration (synthetic CSV import), health, mail (local outbox file).
- **Data:** PostgreSQL 16 + PostGIS 3.4 through Prisma, with hand-written SQL migrations for what Prisma
  cannot model. KPIs are computed live in SQL (`apps/api/src/dashboards/kpi.sql.ts`); there are no stored
  snapshots.
- **Front end:** Tailwind, Recharts, MapLibre GL with no external map tiles.
- **Provisioned but unused:** Redis (no queue is built on it). MinIO is an optional profile and NOT VERIFIED.

## Database

- 46 tables across 8 migrations; `pnpm db:drift-check` (also in CI) fails if migrations and the Prisma schema
  diverge.
- **Tenant isolation:** 43 tables carry a row-level-security policy keyed on a
  per-transaction setting. The API connects as `dcp_app`, which is subject to the policies; migrations run as
  `dcp_owner`. The three tables without a policy are `_prisma_migrations`, `permissions` (global catalogue)
  and PostGIS's `spatial_ref_sys`.
- **Jurisdiction design:** a State → District → Co-district tree with a maintained ancestry path; role
  assignments are scoped to the tenant, a jurisdiction (optionally including children), an agency or a scheme.
- **Money:** `numeric(18,2)` with a currency code; no floating point in storage or in KPI SQL.
- **Rules enforced in the database, not only the API:**
  - allocations cannot exceed their parent ceiling (trigger with row lock);
  - one approved budget version per scheme;
  - verified releases, expenditure and progress cannot be updated; corrections are new rows that supersede;
  - a record cannot be verified by its submitter (expenditure, releases, progress, corrective actions);
  - audit events, export history and import errors are append-only.

Details: `docs/data-layer.md`.
