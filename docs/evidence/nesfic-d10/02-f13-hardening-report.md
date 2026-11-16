# F13 hardening report

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

Branch `devin/1794830432-f13-f15-hardening-demo-evidence` (on top of PR #4). Environment: 8-vCPU / 34 GB
Linux VM, Node 22.23.5, pnpm 9.15.9, Docker Compose (PostgreSQL 16.4 + PostGIS 3.4.3, nginx, API, Redis).

## Baseline defects (from `01-baseline-audit-f01-f12.md`)

| #   | Defect                                          | Outcome                                                                                                                                                                                        |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `maplibre-gl` 4.7.1 critical XSS advisory       | FIXED: upgraded to 6.x. The upgrade broke the map worker in the Docker build (wrong MIME type for `.mjs`); fixed in nginx and the browser test now fails on any worker or CSP console error.   |
| D2  | No CSP / HSTS; versions disclosed               | FIXED: helmet on the API, CSP + HSTS + Permissions-Policy on the static app, `server_tokens off`, no `X-Powered-By`. Tested in `security-headers.e2e-spec.ts` and `scripts/validate-demo.mjs`. |
| D3  | Swagger UI served unauthenticated in production | FIXED: off when `NODE_ENV=production` unless `API_DOCS_ENABLED=true`. Tested.                                                                                                                  |
| D4  | 12 dependency advisories (3 critical, 2 high)   | REDUCED to 3 (2 moderate, 1 low). See below.                                                                                                                                                   |
| D5  | No end-to-end financial reconciliation          | FIXED: `financial-reconciliation.e2e-spec.ts`; output in `evidence/financial-reconciliation.json`.                                                                                             |
| D6  | No startup validation or deployment config      | Startup validation added (`scripts/validate-demo.mjs`). Render blueprint is a DRAFT, not verified (`08-deployment-status.md`).                                                                 |
| D7  | Screens without browser tests                   | OPEN: import, forgot/reset password and budget-revision screens still have API tests only.                                                                                                     |
| D8  | Missing features                                | OPEN by design (feature freeze): see `10-known-limitations.md`.                                                                                                                                |

## Remaining dependency advisories (`pnpm audit`)

| Severity | Package     | Path                            | Why it remains                                       |
| -------- | ----------- | ------------------------------- | ---------------------------------------------------- |
| moderate | `glob`      | `@nestjs/cli` (build tool)      | No `@nestjs/cli` release uses the patched major yet  |
| moderate | `minimatch` | `typescript-eslint` (lint tool) | Same: fixed only in a major the tool does not accept |
| low      | `deepmerge` | `@nestjs/cli` (build tool)      | No patched version exists                            |

All three are in development tooling and are not part of the API runtime image's request path or the
browser bundle. They are not resolved.

## Defects found during F13

| Defect                                                                                                                                                                     | Status                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MapLibre worker failed to load in the Docker build after the upgrade; the existing browser test did not notice                                                             | FIXED and now tested                                                                                                                                                                           |
| Immediately after a 2,000-scheme bulk load in one transaction, the statewide dashboard exceeded its 5 s transaction limit (HTTP 500) until table statistics were refreshed | MITIGATED for the measurement script (runs `ANALYZE`). In normal operation PostgreSQL autovacuum refreshes statistics; a production bulk-import path should analyse after loading. LIMITATION. |
| After `pnpm db:demo-reset` a running API returns HTTP 500 (`cached plan must not change result type`) until restarted                                                      | DOCUMENTED: restart the API after a reset (`09-demo-walkthrough.md`). Not fixed in code.                                                                                                       |

## New automated tests (all pass)

| Suite                                  | What it proves                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `financial-reconciliation.e2e-spec.ts` | Rebuilds every scheme's figures from the raw tables with integer paise arithmetic, independently of the KPI SQL, and compares them with the dashboard rows, dashboard totals, state-summary report and CSV exports. 24 schemes, 0 mismatches.                                                                                                                      |
| `hardening.e2e-spec.ts`                | Two reviewers deciding the same expenditure concurrently: exactly one 201 and one 409. Every registered `/api/v1` route except sign-in, password recovery and health returns 401 anonymously. A District A reviewer gets 403/404 on eight District B read paths that return 200 for an in-scope user. Injection-shaped input causes no 5xx and no widened results. |
| `security-headers.e2e-spec.ts`         | Security headers present; Swagger 404 in production, available in development.                                                                                                                                                                                                                                                                                     |

Controls already covered by earlier suites are listed in `06-security-controls.md`.

## Financial reconciliation (synthetic data, INR)

| Figure                                        | Independent ledger total |
| --------------------------------------------- | -----------------------: |
| Original approved budget                      |           6,10,00,000.00 |
| Revised approved budget                       |           6,20,00,000.00 |
| Allocated (top-level only)                    |           6,17,00,000.00 |
| Funding requested (not counted as allocation) |             51,00,000.00 |
| Releases pending verification                 |             10,33,504.00 |
| Verified releases                             |           2,76,08,000.00 |
| Expenditure submitted, not verified           |              5,02,000.00 |
| Verified expenditure                          |           1,88,87,407.00 |
| Verified expenditure replaced by corrections  |              7,00,000.00 |

Source: `evidence/financial-reconciliation.json` (`allChecksPassed: true`). The figures reflect the test
database at the time of the run, which includes records created by other test suites.

## Performance (measured, `evidence/performance-f13.json`)

Dataset: 2,012 schemes (2,000 bulk `PERF-*` + demo), 2,013 releases, 2,014 expenditure records, 1,506
progress submissions. Requests go through nginx to the API in Docker on the VM above. Single run; no load
test beyond 20 concurrent requests was performed.

| Request                                    | Median                                                               | p95                |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------------ |
| Statewide dashboard                        | 240 ms                                                               | 264 ms             |
| District dashboard                         | 127 ms                                                               | 132 ms             |
| Scheme list, 100/page (page 1 / page 15)   | 78 / 76 ms                                                           | 89 / 720 ms        |
| Filtered scheme list                       | 29 ms                                                                | 31 ms              |
| GIS, all points (1.1 MB)                   | 118 ms                                                               | 130 ms             |
| Budget-vs-expenditure preview / CSV / XLSX | 123 / 111 / 251 ms                                                   | 142 / 119 / 279 ms |
| 20 concurrent statewide dashboards         | wall 777 ms, all 200, identical bodies                               | 773 ms             |
| Alert evaluation (8 rules, 2,012 schemes)  | first 6.3 s (3,589 created), repeat 4.8 s (0 created: de-duplicated) | —                  |

The page-15 p95 is one 720 ms outlier in nine samples. Alert evaluation runs in the background under a
database advisory lock.

## F13 exit criteria

| Criterion                                              | Result                                              |
| ------------------------------------------------------ | --------------------------------------------------- |
| Critical security and financial tests pass             | YES (133/133 API integration + e2e)                 |
| Core approval and reporting journeys pass              | YES (Playwright 15/15 on the Docker stack)          |
| Builds and migrations succeed                          | YES                                                 |
| No unresolved critical defect in demonstrated journeys | YES; open items above are medium/low and documented |
| Evidence saved                                         | YES (`evidence/`)                                   |
| Limitations documented                                 | YES (`10-known-limitations.md`)                     |

Not done in F13: no penetration test, no third-party security review, no load or soak test, no failover test.
