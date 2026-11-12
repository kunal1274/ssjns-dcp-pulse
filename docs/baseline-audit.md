# Baseline audit before F04–F06

Audited on branch `devin/1794506064-f04-f06-auth-rbac-budget`, created from `be48d55` (F01–F03 branch, PR #1). Every check below was executed locally against PostGIS 16-3.4; results are the exit codes observed.

| Check                   | Command                        | Result                                      |
| ----------------------- | ------------------------------ | ------------------------------------------- |
| Formatting              | `pnpm format:check`            | PASS                                        |
| Lint                    | `pnpm lint`                    | PASS (0 warnings)                           |
| Typecheck               | `pnpm typecheck`               | PASS                                        |
| Unit tests              | `pnpm test`                    | PASS — shared 5/5, web 5/5, api 4 suites    |
| Build                   | `pnpm build`                   | PASS                                        |
| Migration drift         | `pnpm db:drift-check`          | PASS — no difference                        |
| Seed (re-run)           | `pnpm db:seed`                 | PASS — idempotent                           |
| Integration + e2e       | `pnpm test:integration`        | PASS — 5 suites, 43/43                      |
| Docker stack            | `docker compose up -d --build` | PASS — db, migrate, api, web, redis healthy |
| GitHub Actions on PR #1 | CI workflow                    | PASS — 3/3 jobs                             |

## Status of F01–F03 prerequisites

| Area                                          | Status   | Notes                                                                                                              |
| --------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Monorepo, shared package, CI                  | COMPLETE |                                                                                                                    |
| Docker environment                            | COMPLETE | MinIO is opt-in (`storage` profile) and untested                                                                   |
| Schema, RLS, triggers, seed                   | COMPLETE |                                                                                                                    |
| Users / credentials / roles / scopes tables   | PARTIAL  | Tables exist, but nothing authenticates users or enforces roles yet                                                |
| Scheme / budget tables                        | PARTIAL  | Tables and DB constraints exist; no APIs; allocations require `scheme_id`, so no jurisdiction-level allocation yet |
| Login, sessions, RBAC, scheme/budget APIs, UI | MISSING  | Scope of F04–F06                                                                                                   |

No failing checks; no prerequisite fixes were needed before starting F04.
