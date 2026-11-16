#!/usr/bin/env node
/**
 * Startup validation for the local Docker demonstration stack (synthetic data only).
 * Read-only apart from signing each demo user in and out. Exits non-zero on any failed check.
 *
 *   SEED_DEMO_PASSWORD=... node scripts/validate-demo.mjs [http://localhost:8080]
 */
const base = (process.argv[2] ?? process.env.DEMO_BASE_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const api = `${base}/api/v1`;
const password = process.env.SEED_DEMO_PASSWORD;
const users = [
  'state.monitor',
  'state.planner',
  'budget.checker',
  'finance.reviewer',
  'finance.checker',
  'district.reviewer',
  'codistrict.reviewer',
  'field.officer',
  'auditor',
  'admin',
].map((u) => `${u}@example.test`);

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function login(email) {
  const res = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `sign-in returned ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const { csrfToken } = await res.json();
  return { cookie, 'x-csrf-token': csrfToken };
}

await check('web container answers /healthz', async () => {
  const res = await fetch(`${base}/healthz`);
  expect(res.ok, `status ${res.status}`);
});
await check('API liveness', async () => {
  const res = await fetch(`${api}/health/live`);
  expect(res.ok, `status ${res.status}`);
});
await check('API readiness: database, PostGIS and migrations', async () => {
  const res = await fetch(`${api}/health/ready`);
  const body = await res.json();
  expect(res.ok && body.status === 'ok', `status ${res.status} ${JSON.stringify(body)}`);
  expect(body.checks.migrations.pending === 0, 'pending migrations');
  return `PostGIS ${body.checks.database.postgisVersion}, ${body.checks.migrations.applied} migrations`;
});
await check('web security headers', async () => {
  const h = (await fetch(`${base}/`)).headers;
  for (const name of [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
  ])
    expect(h.get(name), `missing ${name}`);
  expect(!/\d/.test(h.get('server') ?? ''), 'Server header discloses a version');
});
await check('API does not disclose its framework', async () => {
  const h = (await fetch(`${api}/health/live`)).headers;
  expect(!h.get('x-powered-by'), 'X-Powered-By present');
});
await check('Swagger UI is not exposed', async () => {
  const res = await fetch(`${base}/api/docs`);
  expect(res.status === 404, `status ${res.status} (expected unless API_DOCS_ENABLED=true)`);
});
await check('anonymous API access is refused', async () => {
  const res = await fetch(`${api}/dashboards/state`);
  expect(res.status === 401, `status ${res.status}`);
});

if (!password) {
  results.push({ name: 'demo sign-ins', ok: false, detail: 'SEED_DEMO_PASSWORD is not set' });
} else {
  for (const email of users)
    await check(`sign-in ${email}`, async () => {
      let detail;
      const headers = await login(email);
      const me = await fetch(`${api}/auth/me`, { headers });
      expect(me.ok, `/auth/me returned ${me.status}`);
      if (email.startsWith('state.monitor')) {
        const res = await fetch(`${api}/dashboards/schemes?pageSize=1`, { headers });
        const body = await res.json();
        const total = body.total ?? body.meta?.total;
        expect(res.ok && total > 0, `no seed schemes on the dashboard (status ${res.status})`);
        detail = `${total} synthetic schemes visible`;
      }
      const out = await fetch(`${api}/auth/logout`, { method: 'POST', headers });
      expect(out.status < 400, `sign-out returned ${out.status}`);
      return detail;
    });
}

for (const r of results)
  console.info(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.info(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
process.exit(failed ? 1 : 0);
