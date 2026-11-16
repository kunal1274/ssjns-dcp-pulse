# Roles, permissions and demo accounts

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

Read from the seeded database. Permissions are re-read from active role assignments on every request, so a
revoked role stops working on the next request (tested in `rbac.e2e-spec.ts`).

| Role                 | Permissions                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STATE_MONITOR        | alert.view, audit.view, report.export, report.view, scheme.view                                                                                               |
| STATE_PLANNER        | alert.rule.manage, budget.allocate, budget.request.review, budget.revise, report.view, scheme.approve, scheme.create, scheme.edit, scheme.submit, scheme.view |
| DISTRICT_REVIEWER    | alert.assign, alert.resolve, alert.view, budget.request.create, budget.request.review, progress.verify, report.view, scheme.view                              |
| CO_DISTRICT_REVIEWER | alert.view, budget.request.create, progress.verify, report.view, scheme.view                                                                                  |
| IMPLEMENTING_OFFICER | alert.view, budget.request.create, expenditure.submit, progress.submit, scheme.view                                                                           |
| FINANCE_REVIEWER     | alert.view, expenditure.verify, release.record, report.view, scheme.view                                                                                      |
| AUDITOR              | alert.view, audit.view, report.export, report.view, scheme.view                                                                                               |
| SYSTEM_ADMIN         | alert.rule.manage, audit.view, integration.manage, role.manage, user.manage                                                                                   |

Notes: release decisions use `expenditure.verify` (the specification has no `release.verify`). State Planner
cannot see alerts or export reports. `alert.rule.manage` is an addition to the specification's catalogue.

## Synthetic demo accounts

All use the password set in `SEED_DEMO_PASSWORD` in the local `.env`; no password is committed.

| Account                            | Role                 | Scope                     |
| ---------------------------------- | -------------------- | ------------------------- |
| `state.monitor@example.test`       | STATE_MONITOR        | Tenant-wide               |
| `state.planner@example.test`       | STATE_PLANNER        | Tenant-wide               |
| `budget.checker@example.test`      | STATE_PLANNER        | Tenant-wide (checker)     |
| `finance.reviewer@example.test`    | FINANCE_REVIEWER     | Tenant-wide               |
| `finance.checker@example.test`     | FINANCE_REVIEWER     | Tenant-wide (checker)     |
| `district.reviewer@example.test`   | DISTRICT_REVIEWER    | District A                |
| `codistrict.reviewer@example.test` | CO_DISTRICT_REVIEWER | Co-district A1            |
| `field.officer@example.test`       | IMPLEMENTING_OFFICER | District A and District B |
| `auditor@example.test`             | AUDITOR              | Tenant-wide               |
| `admin@example.test`               | SYSTEM_ADMIN         | Tenant-wide               |
