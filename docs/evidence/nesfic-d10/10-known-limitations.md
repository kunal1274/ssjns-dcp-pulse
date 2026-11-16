# Known limitations

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

**Scope**

- Demonstration on synthetic Assam-style data. No real scheme, budget, location or person is represented.
- No live integration with e-Rupantor or any government system. The import reads a synthetic CSV only; a
  live integration needs an authorised interface specification, credentials, network access and
  data-sharing approval.
- Not deployed to any cloud. No production support arrangement exists.
- Alert thresholds and report due dates are illustrative.

**Features not built**

- Evidence file upload and download (MinIO has never run in this environment).
- PDF report export (CSV and Excel only).
- Email delivery (reset and invite messages are written to a local outbox file).
- Screens for financial-year setup, commitments, milestones and map locations (API only).
- Token refresh (sessions are server-side by design).

**Test gaps**

- Import, forgot/reset password, session-expired and budget-revision screens have API tests but no browser
  test.
- Browser tests run in Chromium only. No accessibility audit.
- No penetration test, third-party review, load, soak or failover test. Performance was measured once on one
  VM at about 2,000 schemes and 20 concurrent requests.

**Operational**

- After a demo reset the API must be restarted.
- Straight after a very large bulk load the statewide dashboard can time out until PostgreSQL refreshes its
  statistics.
- Alert evaluation takes about 5–6 s at 2,000 schemes (background job).
- Three low/moderate dependency advisories remain in development tooling.
- Financial-year rules (month alignment, no overlap) are enforced by the API only.
- State Planner cannot export reports or see alerts.
- The local stack is HTTP only; TLS, backups and monitoring are deployment concerns not configured here.
