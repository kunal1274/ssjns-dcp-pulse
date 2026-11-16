import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

describe('F10 dashboards and KPI service (e2e, real database)', () => {
  let app: INestApplication;
  let owner: Client;
  let planner: Session, district: Session, officer: Session, finance: Session;
  let seq = 0;
  const post = (s: Session, url: string, body: object) =>
    s.agent
      .post(`/api/v1${url}`)
      .set('x-csrf-token', s.csrf)
      .set('Idempotency-Key', `f10-${Date.now()}-${++seq}`)
      .send(body);
  const ids: Record<string, string> = {};
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const D = (v: string | null) => (v === null ? null : Number(v));

  beforeAll(async () => {
    ({ app } = await createApp());
    owner = await ownerClient();
    for (const code of ['AS-DEMO', 'DIST-A', 'DIST-B', 'CD-A1', 'CD-B1'])
      ids[code] = (
        await owner.query(`SELECT id FROM jurisdictions WHERE code = $1`, [code])
      ).rows[0].id;
    ids.demo1 = (
      await owner.query(`SELECT id FROM schemes WHERE scheme_code = 'DEMO-001'`)
    ).rows[0].id;
    planner = await login(app, 'state.planner@example.test');
    district = await login(app, 'district.reviewer@example.test');
    officer = await login(app, 'field.officer@example.test');
    finance = await login(app, 'finance.reviewer@example.test');
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('unverified expenditure only changes reported figures; verification changes verified KPIs', async () => {
    const stamp = Date.now().toString().slice(-9);
    const scheme = (
      await owner.query(
        `INSERT INTO schemes (tenant_id, scheme_code, name, category, financial_year_id, agency_id, jurisdiction_id, status, start_date, target_end_date)
         SELECT s.tenant_id, $1, 'Synthetic F10 test scheme', s.category, s.financial_year_id, s.agency_id, j.id, 'ACTIVE', '2026-04-01', '2027-03-31'
         FROM schemes s JOIN jurisdictions j ON j.tenant_id = s.tenant_id AND j.code = 'CD-A1'
         WHERE s.scheme_code = 'DEMO-001' RETURNING id`,
        [`F10-${stamp}`],
      )
    ).rows[0].id as string;
    const period = (
      await owner.query(
        `SELECT p.id FROM reporting_periods p JOIN schemes s ON s.financial_year_id = p.financial_year_id
         WHERE s.id = $1 ORDER BY p.start_date LIMIT 1`,
        [scheme],
      )
    ).rows[0].id as string;
    const before = (await get(planner, '/dashboards/state').expect(200)).body.totals;
    const e = await post(officer, '/expenditure', {
      schemeId: scheme,
      periodId: period,
      amount: '1234.50',
      expenditureDate: '2026-04-15',
      reference: `F10-EXP-${stamp}`,
    }).expect(201);
    let m = (await get(planner, `/dashboards/scheme/${scheme}`).expect(200)).body.metrics;
    expect(m.verifiedExpenditure).toBe('0.00');
    expect(m.reportedExpenditure).toBe('1234.50');
    expect(m.financialUtilisationPercent).toBeNull();
    expect(m.pendingFinancialVerification).toBe(1);
    const mid = (await get(planner, '/dashboards/state').expect(200)).body.totals;
    expect(mid.verifiedExpenditure).toBe(before.verifiedExpenditure);
    await post(finance, `/expenditure/${e.body.id}/decision`, {
      version: e.body.version,
      decision: 'VERIFY',
    }).expect(201);
    m = (await get(planner, `/dashboards/scheme/${scheme}`).expect(200)).body.metrics;
    expect(m.verifiedExpenditure).toBe('1234.50');
    const after = (await get(planner, '/dashboards/state').expect(200)).body.totals;
    expect(Number(after.verifiedExpenditure) - Number(before.verifiedExpenditure)).toBeCloseTo(
      1234.5,
      2,
    );
  });

  it('scheme 360 reconciles with the scheme finance and progress summaries (T10)', async () => {
    const d = (await get(planner, `/dashboards/scheme/${ids.demo1}`).expect(200)).body;
    const fin = (await get(planner, `/schemes/${ids.demo1}/finance`).expect(200)).body;
    const prog = (await get(planner, `/schemes/${ids.demo1}/progress`).expect(200)).body;
    expect(d.metrics.verifiedExpenditure).toBe(fin.verifiedExpenditure);
    expect(d.metrics.verifiedReleases).toBe(fin.verifiedReleases);
    expect(d.metrics.approvedBudget).toBe(fin.approvedBudget);
    expect(d.metrics.financialUtilisationPercent).toBe(fin.budgetUtilisationPercent);
    expect(d.metrics.releaseUtilisationPercent).toBe(fin.releaseUtilisationPercent);
    expect(d.metrics.physicalCompletionPercent).toBe(prog.physicalCompletionPercent);
    expect(d.approvalHistory.length).toBeGreaterThan(0);
  });

  it('state totals equal the sum of per-scheme rows and of district rows (no double counting)', async () => {
    const st = (await get(planner, '/dashboards/state').expect(200)).body;
    const list = (await get(planner, '/dashboards/schemes?pageSize=100').expect(200)).body;
    expect(list.total).toBe(st.totals.schemeCount);
    const sum = (k: string) =>
      list.items.reduce((a: number, r: Record<string, string | null>) => a + (D(r[k]) ?? 0), 0);
    for (const [row, total] of [
      ['verifiedExpenditure', 'verifiedExpenditure'],
      ['verifiedReleases', 'verifiedReleases'],
      ['allocatedBudget', 'allocatedBudget'],
      ['approvedBudget', 'approvedBudget'],
    ])
      expect(sum(row)).toBeCloseTo(Number(st.totals[total]), 2);
    const districtSum = st.comparison.reduce(
      (a: number, c: { kpis: { verifiedExpenditure: string } | null }) =>
        a + Number(c.kpis?.verifiedExpenditure ?? 0),
      Number(st.directAtThisLevel?.verifiedExpenditure ?? 0),
    );
    expect(districtSum).toBeCloseTo(Number(st.totals.verifiedExpenditure), 2);
    const demo = list.items.find((r: { schemeCode: string }) => r.schemeCode === 'DEMO-001');
    expect(demo.allocatedBudget).toBe('10000000.00');
    expect(st.totals.progressBands).toBeDefined();
    expect(st.totals).not.toHaveProperty('physicalCompletionPercent');
  });

  it('drill-down: district totals reconcile with its co-district rows', async () => {
    const dist = (await get(planner, `/dashboards/district/${ids['DIST-A']}`).expect(200)).body;
    const parts = dist.comparison.reduce(
      (a: number, c: { kpis: { schemeCount: number } | null }) => a + (c.kpis?.schemeCount ?? 0),
      dist.directAtThisLevel?.schemeCount ?? 0,
    );
    expect(parts).toBe(dist.totals.schemeCount);
    const cd = (await get(planner, `/dashboards/co-district/${ids['CD-A1']}`).expect(200)).body;
    expect(cd.totals.schemeCount).toBeLessThanOrEqual(dist.totals.schemeCount);
  });

  it('District A reviewer cannot see District B (T07) and state view is scoped', async () => {
    await get(district, `/dashboards/district/${ids['DIST-B']}`).expect(404);
    await get(district, `/dashboards/co-district/${ids['CD-B1']}`).expect(404);
    await get(district, `/dashboards/district/${ids['DIST-A']}`).expect(200);
    const st = (await get(district, '/dashboards/state').expect(200)).body;
    const codes = st.comparison.map((c: { jurisdiction: { code: string } }) => c.jurisdiction.code);
    expect(codes).not.toContain('DIST-B');
    const b = (await owner.query(`SELECT id FROM schemes WHERE scheme_code = 'DEMO-007'`)).rows[0]
      .id;
    const bj = (
      await owner.query(
        `SELECT j.code FROM schemes s JOIN jurisdictions j ON j.id = s.jurisdiction_id WHERE s.id = $1`,
        [b],
      )
    ).rows[0].code;
    if (bj.startsWith('CD-B')) await get(district, `/dashboards/scheme/${b}`).expect(404);
    await get(officer, '/dashboards/state').expect(403);
  });

  it('reporting-period filter is cumulative to the period end', async () => {
    const early = (await owner.query(`SELECT id FROM reporting_periods WHERE code = '2026-04'`))
      .rows[0]?.id;
    const st = (await get(planner, '/dashboards/state').expect(200)).body;
    if (early) {
      const e = (await get(planner, `/dashboards/state?periodId=${early}`).expect(200)).body;
      expect(Number(e.totals.verifiedExpenditure)).toBeLessThanOrEqual(
        Number(st.totals.verifiedExpenditure),
      );
      expect(e.filters.period.code).toBe('2026-04');
    }
  });

  it('zero denominators give N/A, not errors (T14)', async () => {
    const r = (
      await owner.query(
        `SELECT s.id FROM schemes s WHERE s.status IN ('APPROVED','ACTIVE')
       AND NOT EXISTS (SELECT 1 FROM fund_releases f WHERE f.scheme_id = s.id AND f.verification_status = 'VERIFIED') LIMIT 1`,
      )
    ).rows[0];
    if (r) {
      const d = (await get(planner, `/dashboards/scheme/${r.id}`).expect(200)).body;
      expect(d.metrics.releaseUtilisationPercent).toBeNull();
    }
    const defs = (await get(planner, '/dashboards/kpi-definitions').expect(200)).body;
    expect(defs.items.map((k: { code: string }) => k.code)).toContain('FINANCIAL_UTILISATION');
  });

  it('revoked role assignment blocks the next dashboard request', async () => {
    const uid = (
      await owner.query(`SELECT id FROM users WHERE email = 'district.reviewer@example.test'`)
    ).rows[0].id;
    const saved = await owner.query(
      `SELECT id, valid_to FROM user_role_scopes WHERE user_id = $1`,
      [uid],
    );
    try {
      await owner.query(
        `UPDATE user_role_scopes SET valid_to = now() - interval '1 second' WHERE user_id = $1`,
        [uid],
      );
      await get(district, '/dashboards/state').expect(403);
    } finally {
      for (const s of saved.rows)
        await owner.query(`UPDATE user_role_scopes SET valid_to = $2 WHERE id = $1`, [
          s.id,
          s.valid_to,
        ]);
    }
    await get(district, '/dashboards/state').expect(200);
  });
});
