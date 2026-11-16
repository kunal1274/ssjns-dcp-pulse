# F01–F12 baseline audit (Step 0, before F13–F15)

> Synthetic demonstration data only. DCP Pulse is not a government deployment and is not connected to any
> government system.

Audited 16 Nov 2026 on commit `02bdf29` (branch `devin/1794592560-f10-f12-dashboards-alerts-mis`, PR #4,
which stacks on PRs #3, #2 and #1; none merged). Working tree clean. Environment: 8-vCPU Linux VM, Node 22,
pnpm 9.15.9, Docker Compose stack (PostgreSQL 16.4 + PostGIS 3.4.3, nginx, API, Redis).

## Commands run and actual results

| Check                       | Command                                               | Result                                     |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Formatting                  | `pnpm format:check`                                   | PASS                                       |
| Lint                        | `pnpm lint`                                           | PASS (0 warnings)                          |
| Typecheck                   | `pnpm typecheck`                                      | PASS                                       |
| Build                       | `pnpm build`                                          | PASS                                       |
| Unit tests                  | `pnpm test`                                           | PASS: shared 5/5, web 7/7, API 42/42       |
| Migration drift             | `pnpm db:drift-check`                                 | PASS (8 migrations applied, 0 pending)     |
| API integration + e2e       | `pnpm test:integration`                               | PASS: 14 suites, 123/123                   |
| Docker stack                | `docker compose up -d --build`                        | PASS: db, api, web, redis healthy          |
| Synthetic reset             | `pnpm db:demo-reset` (guarded)                        | PASS: 12 schemes, 10 users                 |
| Browser journeys            | `pnpm test:e2e` (Playwright against the Docker stack) | PASS: 15/15, including the 18-step journey |
| Dependency audit            | `pnpm audit`                                          | FAIL: 12 advisories (3 critical, 2 high)   |
| GitHub Actions on `02bdf29` | CI workflow                                           | PASS: 4 jobs                               |

## Feature status

COMPLETE means backend, database, screen and a passing automated test all exist. Nothing is mocked: every
screen reads the API and every API reads PostgreSQL.

| Feature                                   | Status   | Gap                                                                                           |
| ----------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| F01 monorepo, CI                          | COMPLETE |                                                                                               |
| F02 Docker environment, health checks     | COMPLETE | MinIO (object storage) is opt-in and has never run here: its image cannot be pulled           |
| F03 schema, tenant RLS, synthetic seed    | COMPLETE |                                                                                               |
| F04 authentication, server-side sessions  | COMPLETE | Forgot/reset-password and session-expired screens are API-tested, not browser-tested          |
| F05 scoped RBAC, user and role admin      | COMPLETE |                                                                                               |
| F06 scheme registry, budget planning      | PARTIAL  | Financial-year setup is API-only; revision and funding-request screens are not browser-tested |
| F07 releases, expenditure, corrections    | PARTIAL  | Commitments are API-only; evidence file upload NOT IMPLEMENTED                                |
| F08 physical progress                     | COMPLETE | Milestone setup is API-only                                                                   |
| F09 maker-checker, verification queue     | COMPLETE |                                                                                               |
| F10 KPI service, dashboards, scheme 360   | COMPLETE |                                                                                               |
| F11 alerts, corrective actions, GIS       | COMPLETE | Location setup is API-only                                                                    |
| F12 MIS reports (CSV/XLSX), import, reset | PARTIAL  | PDF export NOT IMPLEMENTED; import screen not browser-tested                                  |

## Prioritised defect list

| #   | Priority | Defect                                                                                                                                                    | Planned action (F13/F14)                     |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| D1  | High     | `maplibre-gl@4.7.1` (runtime, browser) has a critical XSS-sanitizer advisory; fixed in 6.4.1                                                              | Upgrade and re-run the map tests             |
| D2  | High     | No Content-Security-Policy, HSTS or Permissions-Policy header; `X-Powered-By` and the nginx version are disclosed                                         | Add headers, hide versions, test them        |
| D3  | High     | Swagger UI (`/api/docs`) is served without authentication in production mode                                                                              | Disable outside development unless opted in  |
| D4  | Medium   | Other audit advisories: `uuid` via `exceljs` (runtime, moderate), `deepmerge-ts` via Prisma CLI, and dev-only tools (vitest, playwright, glob, minimatch) | Upgrade or override; document what remains   |
| D5  | Medium   | No single automated reconciliation that ties budgets → releases → expenditure → dashboard → MIS export on one dataset                                     | Add reconciliation suite and save its output |
| D6  | Medium   | No startup validation script; no deployment (Render) configuration or documentation                                                                       | Add in F14                                   |
| D7  | Low      | Import screen, forgot/reset password and budget revisions have no browser test                                                                            | Add browser tests where time allows          |
| D8  | Low      | Evidence upload, PDF report export, and screens for financial years, commitments, milestones and locations are missing                                    | Feature freeze: document as limitations      |

No failing functional test and no mocked or disconnected screen was found. Further defects found by the
F13 direct-API security and concurrency tests are recorded in `02-f13-hardening-report.md`.
