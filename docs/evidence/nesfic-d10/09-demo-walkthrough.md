# Demonstration walkthrough and screenshot inventory

> Synthetic demonstration data only. DCP Pulse is not a government deployment, is not connected to any
> government system, and has not been certified or penetration-tested.

## Start

```bash
cp .env.example .env            # replace every CHANGE_ME value
docker compose up -d --build    # database, migrations + synthetic seed, API, web
SEED_DEMO_PASSWORD=... node scripts/validate-demo.mjs   # 17 checks; exits non-zero on failure
```

Open `http://localhost:8080`. The validation script signs in ten times; with the default sign-in limit of
10 per minute, wait a minute before running it again or before the browser tests.

## Reset to the clean synthetic state

```bash
docker compose run --rm -e NODE_ENV=development \
  -e DEMO_RESET_CONFIRM=RESET-SYNTHETIC-DEMO migrate pnpm db:demo-reset
docker compose restart api      # required: the running API fails until restarted after a reset
```

The reset refuses without the confirmation value, when `NODE_ENV=production`, or if any tenant other than
the synthetic demo and test tenants exists.

## Walkthrough (about 10 minutes)

Accounts are listed in `05-roles-and-permissions.md`.

| #   | Sign in as                                 | Show                                                                                                 | Screenshot                                    |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `state.monitor`                            | Statewide dashboard: budget, releases, verified vs reported expenditure, progress bands, open alerts | `screenshots/01-state-dashboard.png`          |
| 2   | `state.monitor`                            | Drill down to District A                                                                             | `screenshots/02-district-dashboard.png`       |
| 3   | `state.monitor`                            | Scheme 360 for a scheme with ₹1,00,00,000 approved and ₹70,00,000 released                           | `screenshots/03-scheme-360-before.png`        |
| 4   | `field.officer`                            | Finance: submit expenditure. Progress: submit a progress report                                      | —                                             |
| 5   | `finance.reviewer`, `district.reviewer`    | Verification queue: verify the expenditure and the progress report (not your own)                    | —                                             |
| 6   | `state.monitor`                            | Scheme 360 now shows 55.00% utilisation, 40% physical, 15.00-point gap                               | `screenshots/04-scheme-360-verified.png`      |
| 7   | `district.reviewer`                        | Alerts: the gap alert, assign it                                                                     | `screenshots/05-alert-assigned.png`           |
| 8   | `district.reviewer` then a second reviewer | Corrective action recorded, then independently verified and closed                                   | `screenshots/06-corrective-action-closed.png` |
| 9   | `state.monitor`                            | Map: synthetic scheme locations, in-scope only                                                       | `screenshots/07-gis-map.png`                  |
| 10  | `state.monitor`                            | Reports: district report, CSV/Excel export                                                           | `screenshots/08-mis-report.png`               |
| 11  | `auditor`                                  | Approval and audit history                                                                           | `screenshots/09-audit-history.png`            |
| 12  | `state.planner`                            | Optional: alert counts show "Restricted" and export is unavailable for this role                     | —                                             |

On the seeded data, scheme **DEMO-001** already shows the 55% / 40% gap, so steps 4–5 can be skipped.

## Screenshot inventory

All nine files in `screenshots/` were captured on 16 Nov 2026 by the automated journey `e2e/nesfic.spec.ts`
running against the local Docker stack on this branch, from working pages with synthetic data. No screenshot
was edited or staged. Steps marked "—" have no screenshot.
