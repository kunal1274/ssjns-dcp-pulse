import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

interface Route {
  method: string;
  path: string;
}

/** Every route registered on the Express router (Express 4 `_router` or Express 5 `router`). */
function routes(app: INestApplication): Route[] {
  const inst = app.getHttpAdapter().getInstance() as {
    _router?: { stack: unknown[] };
    router?: { stack: unknown[] };
  };
  const stack = (inst._router ?? inst.router)!.stack as {
    route?: { path: string; methods: Record<string, boolean> };
  }[];
  return stack
    .filter((l) => l.route)
    .flatMap((l) =>
      Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })),
    );
}

describe('F13 security and concurrency hardening (e2e, real database)', () => {
  let app: INestApplication;
  let owner: Client;
  let officer: Session, finance: Session, checker: Session, district: Session, monitor: Session;
  let seq = 0;
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const post = (s: Session, url: string, body: object) =>
    s.agent
      .post(`/api/v1${url}`)
      .set('x-csrf-token', s.csrf)
      .set('Idempotency-Key', `f13-${Date.now()}-${++seq}`)
      .send(body);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app } = await createApp());
    owner = await ownerClient();
    officer = await login(app, 'field.officer@example.test');
    finance = await login(app, 'finance.reviewer@example.test');
    checker = await login(app, 'finance.checker@example.test');
    district = await login(app, 'district.reviewer@example.test');
    monitor = await login(app, 'state.monitor@example.test');
    ids.distB = (
      await owner.query(`SELECT id FROM jurisdictions WHERE code = 'DIST-B'`)
    ).rows[0].id;
    const b = (
      await owner.query(
        `SELECT s.id FROM schemes s JOIN jurisdictions j ON j.id = s.jurisdiction_id
         WHERE j.code IN ('CD-B1', 'CD-B2', 'DIST-B') AND s.status = 'ACTIVE' ORDER BY s.scheme_code LIMIT 1`,
      )
    ).rows[0];
    ids.schemeB = b.id;
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('two reviewers verifying the same expenditure at once: exactly one decision is recorded', async () => {
    const stamp = Date.now().toString().slice(-9);
    const scheme = (
      await owner.query(
        `INSERT INTO schemes (tenant_id, scheme_code, name, category, financial_year_id, agency_id, jurisdiction_id, status, start_date, target_end_date)
         SELECT s.tenant_id, $1, 'Synthetic F13 concurrency scheme', s.category, s.financial_year_id, s.agency_id, j.id, 'ACTIVE', '2026-04-01', '2027-03-31'
         FROM schemes s JOIN jurisdictions j ON j.tenant_id = s.tenant_id AND j.code = 'CD-A1'
         WHERE s.scheme_code = 'DEMO-001' RETURNING id`,
        [`F13-${stamp}`],
      )
    ).rows[0].id as string;
    const period = (
      await owner.query(
        `SELECT p.id FROM reporting_periods p JOIN schemes s ON s.financial_year_id = p.financial_year_id
         WHERE s.id = $1 ORDER BY p.start_date LIMIT 1`,
        [scheme],
      )
    ).rows[0].id as string;
    const e = (
      await post(officer, '/expenditure', {
        schemeId: scheme,
        periodId: period,
        amount: '4321.00',
        expenditureDate: '2026-04-20',
        reference: `F13-EXP-${stamp}`,
      }).expect(201)
    ).body;
    const body = { version: e.version, decision: 'VERIFY' };
    const results = await Promise.all([
      post(finance, `/expenditure/${e.id}/decision`, body),
      post(checker, `/expenditure/${e.id}/decision`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const row = (
      await owner.query(`SELECT status::text, version FROM expenditure_records WHERE id = $1`, [
        e.id,
      ])
    ).rows[0];
    expect(row).toEqual({ status: 'VERIFIED', version: e.version + 1 });
    const fin = (await get(finance, `/schemes/${scheme}/finance`).expect(200)).body;
    expect(fin.verifiedExpenditure).toBe('4321.00');
    const audits = await owner.query(
      `SELECT COUNT(*)::int n FROM audit_events WHERE entity_id = $1 AND action ILIKE '%VERIF%'`,
      [e.id],
    );
    expect(audits.rows[0].n).toBe(1);
    // A late decision against the already-verified record is refused and changes nothing.
    await post(checker, `/expenditure/${e.id}/decision`, {
      version: e.version + 1,
      decision: 'REJECT',
      reason: 'late',
    }).expect((r) => expect([400, 409]).toContain(r.status));
    expect((await get(finance, `/schemes/${scheme}/finance`)).body.verifiedExpenditure).toBe(
      '4321.00',
    );
  });

  it('every registered route except sign-in, password recovery and health refuses anonymous callers', async () => {
    // The `{*path}` entries are the JSON 404 fallback, not handlers.
    const all = routes(app).filter(
      (r) =>
        r.path.startsWith('/api/v1/') &&
        !r.path.includes('*') &&
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    );
    expect(all.length).toBeGreaterThan(80);
    const isPublic = (p: string) =>
      /^\/api\/v1\/(health|auth\/(login|forgot-password|reset-password|accept-invite))(\/|$)/.test(
        p,
      );
    const open: string[] = [];
    for (const r of all.filter((x) => !isPublic(x.path))) {
      const url = r.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
      const agent = request(app.getHttpServer());
      const call =
        r.method === 'GET'
          ? agent.get(url)
          : agent[r.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](url).send({});
      const res = await call.catch((e: Error) => ({ status: `error ${e.message}` }));
      if (res.status !== 401) open.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('a District A reviewer cannot reach District B records by ID on any read path', async () => {
    const s = ids.schemeB;
    const denied: [string, number][] = [];
    for (const url of [
      `/schemes/${s}`,
      `/schemes/${s}/finance`,
      `/schemes/${s}/progress`,
      `/dashboards/scheme/${s}`,
      `/dashboards/district/${ids.distB}`,
      `/gis/schemes/${s}`,
      `/reports/district-progress?jurisdictionId=${ids.distB}`,
      `/reports/scheme-history?schemeId=${s}`,
    ]) {
      // The same URL works for an in-scope user, so a refusal is about scope, not a bad path.
      const ok = await get(monitor, url);
      if (ok.status !== 200) denied.push([`monitor ${url}`, ok.status]);
      const res = await get(district, url);
      if (![403, 404].includes(res.status)) denied.push([url, res.status]);
    }
    expect(denied).toEqual([]);
    for (const url of [`/fund-releases?schemeId=${s}`, `/expenditure?schemeId=${s}`]) {
      const res = await get(district, url);
      if (res.status === 200) expect(res.body.items).toEqual([]);
      else expect([403, 404]).toContain(res.status);
    }
    const list = (await get(district, '/dashboards/schemes?pageSize=100').expect(200)).body;
    expect(list.items.some((x: { id: string }) => x.id === s)).toBe(false);
    const gis = (await get(district, '/gis/schemes').expect(200)).body;
    expect(JSON.stringify(gis)).not.toContain(s);
    // Writes against the out-of-scope scheme are refused too.
    const w = await post(district, '/fund-releases', {
      schemeId: s,
      amount: '1.00',
      releaseDate: '2026-08-01',
      reference: 'F13-BOLA',
    });
    expect([403, 404]).toContain(w.status);
  });

  it('injection-shaped input is treated as data: no server errors and no widened results', async () => {
    const payloads = [
      "' OR '1'='1",
      "'; DROP TABLE schemes;--",
      '<script>alert(1)</script>',
      '%27%20OR%201=1',
    ];
    const base = (await get(monitor, '/dashboards/schemes?pageSize=100').expect(200)).body.total;
    for (const p of payloads) {
      const q = encodeURIComponent(p);
      for (const url of [
        `/dashboards/state?category=${q}`,
        `/dashboards/schemes?category=${q}`,
        `/dashboards/state?financialYearId=${q}`,
        `/schemes?search=${q}`,
        `/schemes/${q}`,
        `/reports/budget-vs-expenditure?jurisdictionId=${q}`,
        `/gis/schemes?category=${q}`,
        `/alerts?status=${q}`,
      ]) {
        const res = await get(monitor, url);
        expect([url, res.status < 500]).toEqual([url, true]);
        expect(res.headers['content-type'] ?? '').toContain('application/json');
      }
      const filtered = (await get(monitor, `/dashboards/schemes?category=${q}`)).body;
      if (filtered.total !== undefined) expect(filtered.total).toBe(0);
    }
    expect((await get(monitor, '/dashboards/schemes?pageSize=100').expect(200)).body.total).toBe(
      base,
    );
    expect((await owner.query(`SELECT COUNT(*)::int n FROM schemes`)).rows[0].n).toBeGreaterThan(0);
  });
});
