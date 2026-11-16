# Implementation status and traceability

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

Labels: **IMPLEMENTED** = backend, database, screen and a passing automated test. **PARTIAL** = works, with
the stated gap. **PLANNED** = not built. **NOT VERIFIED** = built or drafted but never exercised.

| Stage | Requirement                                             | Status      | Gap                                                                                           | Evidence (automated test)                                                                  |
| ----- | ------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F01   | Monorepo, lint, typecheck, CI                           | IMPLEMENTED |                                                                                               | `.github/workflows/ci.yml`                                                                 |
| F02   | Docker stack, health checks, environment templates      | IMPLEMENTED | MinIO profile NOT VERIFIED (image could not be pulled)                                        | `health.e2e-spec.ts`, `scripts/validate-demo.mjs`                                          |
| F03   | Tenant-aware schema, row-level security, synthetic seed | IMPLEMENTED |                                                                                               | `test/integration/*`, `pnpm db:drift-check`                                                |
| F04   | Sign-in, server-side sessions, CSRF, lockout, reset     | IMPLEMENTED | Reset and session-expired screens are API-tested only                                         | `auth.e2e-spec.ts`, `auth-rate-limit.e2e-spec.ts`, `e2e/journeys.spec.ts`                  |
| F05   | Scoped role-based access, user and role administration  | IMPLEMENTED |                                                                                               | `rbac.e2e-spec.ts`, `e2e/journeys.spec.ts`                                                 |
| F06   | Scheme registry and budget planning                     | PARTIAL     | Financial-year setup has no screen; revision and funding-request screens have no browser test | `schemes-budget.e2e-spec.ts`, `e2e/journeys.spec.ts`                                       |
| F07   | Releases, expenditure, corrections                      | PARTIAL     | Commitments have no screen; evidence file upload PLANNED                                      | `finance-progress.e2e-spec.ts`, `e2e/finance.spec.ts`                                      |
| F08   | Physical progress and milestones                        | IMPLEMENTED | Milestone setup has no screen                                                                 | `finance-progress.e2e-spec.ts`, `scheme-setup.e2e-spec.ts`                                 |
| F09   | Maker-checker and verification queue                    | IMPLEMENTED |                                                                                               | `finance-progress.e2e-spec.ts`, `hardening.e2e-spec.ts`                                    |
| F10   | KPI service, dashboards, Scheme 360                     | IMPLEMENTED |                                                                                               | `dashboards.e2e-spec.ts`, `financial-reconciliation.e2e-spec.ts`, `e2e/dashboards.spec.ts` |
| F11   | Alerts, corrective actions, GIS map                     | IMPLEMENTED | Location setup has no screen                                                                  | `alerts.e2e-spec.ts`, `e2e/alerts.spec.ts`                                                 |
| F12   | MIS reports (CSV, XLSX), synthetic import, demo reset   | PARTIAL     | PDF export PLANNED; import screen has no browser test                                         | `reports-imports.e2e-spec.ts`, `e2e/nesfic.spec.ts`                                        |
| F13   | Security, financial, approval and performance hardening | IMPLEMENTED | No penetration, load or failover test                                                         | `02-f13-hardening-report.md`                                                               |
| F14   | Demo readiness                                          | PARTIAL     | Render blueprint NOT VERIFIED; no cloud deployment                                            | `09-demo-walkthrough.md`, `08-deployment-status.md`                                        |
| F15   | Evidence package                                        | PARTIAL     | Application alignment and other-product mapping are evidence-pending                          | this directory                                                                             |

Not built at all (PLANNED): evidence file upload, PDF export, any live government or e-Rupantor integration,
email delivery (messages are written to a local outbox file), background job queue on Redis.

Earlier per-requirement matrices: `docs/traceability-f04-f06.md`, `docs/traceability-f07-f09.md`, `README.md`
in this directory (F10–F12).
