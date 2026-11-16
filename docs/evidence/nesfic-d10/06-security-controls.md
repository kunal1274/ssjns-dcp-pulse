# Security control summary

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

Each control lists the automated test that exercises it. "Reviewed" means checked by hand in F13 without a
dedicated test.

| Area                        | Control                                                                                                                                      | Evidence                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Passwords                   | Argon2id; legacy bcrypt seed hashes upgraded on first sign-in                                                                                | `auth.e2e-spec.ts`, password unit tests                                                 |
| Sessions                    | Random token in an HttpOnly SameSite cookie; only its hash is stored; idle and absolute expiry; logout and logout-all revoke server-side     | `auth.e2e-spec.ts`                                                                      |
| CSRF                        | Token header required on every state-changing request                                                                                        | `auth.e2e-spec.ts`                                                                      |
| Brute force                 | Per-minute rate limit on sign-in and password recovery; account lockout; identical error for unknown user, wrong password and unknown tenant | `auth-rate-limit.e2e-spec.ts`, `auth.e2e-spec.ts`                                       |
| Suspended and invited users | Denied; existing sessions stop working                                                                                                       | `auth.e2e-spec.ts`, `rbac.e2e-spec.ts`                                                  |
| Anonymous access            | Every route except sign-in, password recovery and health returns 401                                                                         | `hardening.e2e-spec.ts`                                                                 |
| Tenant isolation            | PostgreSQL row-level security on every tenant table; cross-tenant IDs denied                                                                 | `rbac.e2e-spec.ts`, `test/integration`                                                  |
| Object-level authorisation  | Jurisdiction, agency and scheme scope checked on reads and decisions, including by direct ID                                                 | `hardening.e2e-spec.ts`, `finance-progress.e2e-spec.ts` (T07), `dashboards.e2e-spec.ts` |
| Privilege escalation        | No self-assignment; scoped managers delegate only what they hold, inside their scope                                                         | `rbac.e2e-spec.ts`                                                                      |
| Maker-checker               | Self-verification refused by the API and by database constraints; concurrent decisions: exactly one wins                                     | `finance-progress.e2e-spec.ts`, `hardening.e2e-spec.ts`                                 |
| Audit                       | Append-only audit events written in the same transaction; audit views need `audit.view`                                                      | `test/integration`, `reports-imports.e2e-spec.ts`                                       |
| SQL injection               | Parameterised queries only; injection-shaped input yields no 5xx and no widened results                                                      | `hardening.e2e-spec.ts`                                                                 |
| XSS                         | React escaping; Content-Security-Policy with `script-src 'self'`; map popups tested with no CSP violations                                   | `security-headers.e2e-spec.ts`, `e2e/alerts.spec.ts`                                    |
| Clickjacking, sniffing      | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS, no version disclosure                                                    | `security-headers.e2e-spec.ts`, `scripts/validate-demo.mjs`                             |
| API documentation           | Swagger off in production unless explicitly enabled                                                                                          | `security-headers.e2e-spec.ts`                                                          |
| Exports                     | Need `report.export`; scope-filtered; streamed with `no-store`, never stored; logged                                                         | `reports-imports.e2e-spec.ts`                                                           |
| Formula injection           | CSV/XLSX cells starting with `= + - @ tab CR                                                                                                 | %`are prefixed with`'`                                                                  | `export.spec.ts` |
| GIS                         | Only in-scope schemes returned; alert details hidden without `alert.view`                                                                    | `alerts.e2e-spec.ts`, `e2e/alerts.spec.ts`                                              |
| Imports                     | Need `integration.manage`; validated, staged, idempotent; imported releases stay pending until a second person verifies                      | `reports-imports.e2e-spec.ts`                                                           |
| Secrets                     | `.env` is not tracked; local secret values do not appear in the repository (searched in F13); no secrets in compose defaults                 | Reviewed                                                                                |
| Logs                        | Structured logs with redaction of credentials and cookies; authentication events stored without secrets                                      | `logging.spec.ts`, `auth.e2e-spec.ts`                                                   |
| Dependencies                | `pnpm audit`: 0 critical, 0 high; 2 moderate and 1 low remain in development tooling                                                         | `02-f13-hardening-report.md`                                                            |

## Not applicable or not done

- **File uploads and evidence downloads:** evidence upload is not built, so there is no upload or download
  path to authorise. The only file input is the synthetic CSV import (request body capped at 2 MB by nginx).
- **Not performed:** penetration test, third-party security review, threat model sign-off, TLS configuration
  (the local stack is HTTP only; `COOKIE_SECURE=true` is required behind TLS).
