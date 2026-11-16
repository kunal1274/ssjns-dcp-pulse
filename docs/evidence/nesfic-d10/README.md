# NESFIC-D-10 evidence pack (F10–F12)

> Synthetic demonstration data only. DCP Pulse is not connected to any government system and is not a
> government deployment. Thresholds are illustrative. Screenshots were captured by the automated
> NESFIC journey (`e2e/nesfic.spec.ts`) against the local Docker stack after `pnpm db:demo-reset`.

## Index (F13–F15)

This file is the F10–F12 pack as written at that stage; its test counts and limitations are superseded by:

| File                                 | Contents                                              |
| ------------------------------------ | ----------------------------------------------------- |
| `01-baseline-audit-f01-f12.md`       | Baseline audit before hardening                       |
| `02-f13-hardening-report.md`         | Defects fixed, new tests, reconciliation, performance |
| `03-implementation-status.md`        | Status and traceability matrix                        |
| `04-architecture-and-database.md`    | Architecture and database summary                     |
| `05-roles-and-permissions.md`        | Role matrix and demo accounts                         |
| `06-security-controls.md`            | Security controls and their tests                     |
| `07-test-execution-report.md`        | Commands run and results                              |
| `08-deployment-status.md`            | Not deployed; Render draft and open points            |
| `09-demo-walkthrough.md`             | Start, reset, walkthrough, screenshot inventory       |
| `10-known-limitations.md`            | Limitations                                           |
| `11-submission-checklist.md`         | Checklist and readiness verdict                       |
| `12-application-alignment-review.md` | EVIDENCE PENDING                                      |
| `13-capability-mapping.md`           | DCP Pulse only; other products EVIDENCE PENDING       |
| `proof-of-work-dcp-pulse.pdf`        | Compiled from files 02–10 and the screenshots         |
| `evidence/`                          | Saved reconciliation and performance output           |

## Feature status (only items with a passing automated test are COMPLETE)

| Area                                                                                                                                                           | Status                                           | Evidence                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| F10 KPI service (exact decimals, zero denominators = N/A, no double-counted allocations, period cutoff, physical bands)                                        | COMPLETE                                         | `apps/api/src/dashboards/*`, `test/e2e/dashboards.e2e-spec.ts`, `kpis.spec.ts` |
| F10 state / district / co-district / scheme 360 dashboards with filters and drill-down                                                                         | COMPLETE                                         | `e2e/dashboards.spec.ts`, NESFIC steps 1–6, 10–11                              |
| F11 alert engine (8 rules, dedup, reopen, auto-resolve, escalation, scheduled + event-triggered)                                                               | COMPLETE                                         | `test/e2e/alerts.e2e-spec.ts`, NESFIC step 12                                  |
| F11 alert rule configuration (versioned, audited)                                                                                                              | COMPLETE                                         | `e2e/alerts.spec.ts`                                                           |
| F11 corrective actions (independent verification enforced in API and DB)                                                                                       | COMPLETE                                         | `alerts.e2e-spec.ts`, `e2e/alerts.spec.ts`, NESFIC 13–15                       |
| F11 GIS map (MapLibre, no external tiles, scope-filtered, synthetic labels, missing/invalid coordinates)                                                       | COMPLETE                                         | `e2e/alerts.spec.ts`, NESFIC 16                                                |
| Scheme milestones and synthetic location API (`POST /schemes/:id/milestones`, `PUT /schemes/:id/location`)                                                     | COMPLETE (API only, no edit screen)              | `test/e2e/scheme-setup.e2e-spec.ts`                                            |
| F12 ten MIS reports, CSV + XLSX export, metadata, formula-injection guard, export history + audit                                                              | COMPLETE                                         | `test/e2e/reports-imports.e2e-spec.ts`, `export.spec.ts`, NESFIC 17–18         |
| F12 PDF export                                                                                                                                                 | NOT STARTED                                      | —                                                                              |
| F12 synthetic e-Rupantor-style CSV import (source config, mapping, validation, duplicates, preview, errors, reconciliation, idempotent re-import, batch audit) | COMPLETE (API); screen built, not browser-tested | `reports-imports.e2e-spec.ts`, adapter unit tests                              |
| F12 demo reset limited to synthetic tenants                                                                                                                    | COMPLETE                                         | `pnpm db:demo-reset` (guard refusal and reset run manually; see below)         |
| F12 NESFIC 18-step journey                                                                                                                                     | COMPLETE                                         | `e2e/nesfic.spec.ts`, `screenshots/`                                           |
| F12 performance measurements                                                                                                                                   | COMPLETE                                         | `performance-results.json`                                                     |
| Evidence file upload (MinIO)                                                                                                                                   | NOT STARTED                                      | MinIO image cannot be pulled in this environment                               |

## NESFIC journey → screenshot

| Steps                                                                         | Screenshot                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| 1–2 statewide dashboard                                                       | `screenshots/01-state-dashboard.png`          |
| 3–4 District A dashboard lists the scheme                                     | `screenshots/02-district-dashboard.png`       |
| 5–6 scheme 360: ₹1,00,00,000 approved, ₹70,00,000 released                    | `screenshots/03-scheme-360-before.png`        |
| 7–11 40% physical and ₹55 lakh verified → 55.00% utilisation, 15.00-point gap | `screenshots/04-scheme-360-verified.png`      |
| 12–13 gap alert raised and assigned                                           | `screenshots/05-alert-assigned.png`           |
| 14–15 corrective action recorded, independently verified and closed           | `screenshots/06-corrective-action-closed.png` |
| 16 scheme on GIS map                                                          | `screenshots/07-gis-map.png`                  |
| 17 district-level MIS report and CSV export                                   | `screenshots/08-mis-report.png`               |
| 18 auditor reviews approval and audit history                                 | `screenshots/09-audit-history.png`            |

The fixture (scheme, milestone, location, ₹1 crore budget hierarchy, ₹70 lakh verified release) is created
through the real APIs with a fresh scheme code per run; every later step is driven through the UI.

## Performance (measured, see `performance-results.json`)

Dataset: 2,015 schemes (2,000 bulk `PERF-*` + demo), 2,016 releases, 2,018 expenditure records, 1,509
progress submissions; Docker stack through nginx on an 8-vCPU / 34 GB Linux VM, PostgreSQL 16.4.

| Request                                           | Median                                                              | p95                |
| ------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| Statewide dashboard                               | 157 ms                                                              | 242 ms             |
| District dashboard                                | 119 ms                                                              | 187 ms             |
| Scheme list (100/page, page 1 / page 15)          | 66 / 69 ms                                                          | 96 / 94 ms         |
| GIS (all 2,015 points, 1.1 MB)                    | 91 ms                                                               | 98 ms              |
| Budget-vs-expenditure report preview / CSV / XLSX | 98 / 95 / 204 ms                                                    | 121 / 166 / 207 ms |
| 20 concurrent statewide dashboards                | wall 564 ms, all 200, identical totals                              | 509 ms             |
| Alert evaluation (8 rules, 2,015 schemes)         | first 8.4 s (3,587 alerts created), repeat 5.5 s (0 created: dedup) | —                  |

Found and fixed during measurement: the jurisdiction-subtree filter made PostgreSQL misestimate row counts,
so the statewide dashboard took 6.5 s and hit the 5 s transaction timeout (HTTP 500). It is now a semi-join on
the jurisdiction subtree (`kpi.sql.ts`); the same query takes ~0.1 s.

## Test execution (this branch, local)

- API unit tests, web unit tests (7), format, lint, typecheck, build, migration drift: pass.
- API integration + e2e against PostGIS: 14 suites / 120 tests; all pass after the seed-count fix.
- Playwright against the Docker stack: 15/15 pass (includes the NESFIC journey).

## Security controls exercised by tests

Tenant RLS on every new table; jurisdiction scope on reports, GIS and imports; exports need `report.export`,
audit activity needs tenant-wide `audit.view`; export history and import errors are append-only for the app
role; imported releases stay PENDING until a different finance user verifies; CSV/XLSX cells beginning with
`= + - @ tab CR | %` are prefixed with `'`; exports are streamed with `Cache-Control: no-store` and never stored.

## Demo operations

```bash
docker compose up -d --build                      # start
docker compose run --rm -e NODE_ENV=development \
  -e DEMO_RESET_CONFIRM=RESET-SYNTHETIC-DEMO migrate pnpm db:demo-reset   # reset synthetic data
SEED_DEMO_PASSWORD=... EVIDENCE_DIR=$PWD/docs/evidence/nesfic-d10/screenshots pnpm test:e2e
```

The reset refuses without the confirmation value, when `NODE_ENV=production`, or if any tenant other than the
demo/test tenants exists.

## Known limitations

- No live e-Rupantor or other government API; the import adapter reads synthetic CSV only. A live integration
  needs an authorised interface specification, credentials, network access and data-sharing approval.
- PDF export and evidence-file upload are not implemented.
- State Planner has no `report.export`; exports in the journey are made by the State Monitor role.
- Milestones and locations have an API but no edit screen. The import screen is not covered by a browser test.
- Alert evaluation is ~5–8 s at 2,000 schemes; it runs in the background and is serialised by an advisory lock.
- No cloud deployment was made.
