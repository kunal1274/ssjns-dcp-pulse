# Deployment status

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

| Target                | Status                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Local Docker Compose  | VERIFIED: builds, migrates, seeds, passes startup validation and the browser journeys                                                  |
| GitHub Actions CI     | VERIFIED on PRs #1–#4; this branch's run is recorded on its PR                                                                         |
| Render (or any cloud) | **NOT DEPLOYED.** No public URL exists. Deployment needs the owner's approval because it creates paid resources and a public endpoint. |

## Render readiness

`render.yaml` in the repository root is a **draft that has never been applied**. What is ready and what is
open:

- **Ready:** both images build from the repository root; the web image takes the API address from
  `API_UPSTREAM` (verified locally with the default); the API reads all settings from environment variables,
  with Swagger off and secure cookies available for production.
- **Open, must be resolved before a deployment:**
  1. **Database roles.** The app needs two roles (`dcp_owner` for migrations, `dcp_app` for runtime, subject
     to row-level security). `pnpm db:bootstrap-roles` creates them and needs a login allowed to create
     roles. Whether a managed Render database permits this is not verified. Running the API as the owner
     role would bypass tenant isolation and must not be done.
  2. **PostGIS.** The first migration runs `CREATE EXTENSION postgis`; availability on the chosen plan is not
     verified.
  3. **Migrate and seed.** Locally the `migrate` compose service runs roles → migrations → seed. Render has
     no equivalent in the draft; it needs a one-off job or pre-deploy command.
  4. **Cost.** A private API service, a web service and a managed database are paid plans.
  5. **Secrets.** `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SEED_DEMO_PASSWORD` and `APP_BASE_URL` must be
     set in the dashboard; none are committed.
  6. **Demo reset** refuses to run when `NODE_ENV=production`, by design.
