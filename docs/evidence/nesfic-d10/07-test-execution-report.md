# Test execution report

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

Run on 16 Nov 2026 on branch `devin/1794830432-f13-f15-hardening-demo-evidence`, 8-vCPU / 34 GB Linux VM,
Node 22.23.5, pnpm 9.15.9, PostgreSQL 16.4 + PostGIS 3.4.3.

| Check                         | Command                                  | Result                                         |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Formatting                    | `pnpm format:check`                      | PASS                                           |
| Lint                          | `pnpm lint`                              | PASS (0 warnings)                              |
| Typecheck                     | `pnpm typecheck`                         | PASS (3 packages)                              |
| Build                         | `pnpm build`                             | PASS                                           |
| Unit tests                    | `pnpm test`                              | PASS: shared 5/5, web 7/7, API 42/42           |
| Migration drift               | `pnpm db:drift-check`                    | PASS                                           |
| API integration + e2e         | `pnpm test:integration`                  | PASS: 17 suites, 133/133                       |
| Docker stack                  | `docker compose up -d --build`           | PASS                                           |
| Startup validation            | `node scripts/validate-demo.mjs`         | PASS: 17/17                                    |
| Browser journeys (Playwright) | `pnpm test:e2e` against the Docker stack | PASS: 15/15, including the 18-step journey     |
| Guarded demo reset            | `pnpm db:demo-reset`                     | PASS: 12 schemes, 10 users                     |
| Performance measurement       | `pnpm --filter @dcp/api perf`            | Completed; see `evidence/performance-f13.json` |
| Dependency audit              | `pnpm audit`                             | 3 advisories remain (2 moderate, 1 low)        |

Not run: load, soak, failover, cross-browser (Chromium only), accessibility audit, penetration test.
