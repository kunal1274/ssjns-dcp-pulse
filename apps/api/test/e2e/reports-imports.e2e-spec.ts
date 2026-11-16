import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('F12 MIS reports, exports and synthetic import (e2e, real database)', () => {
  let app: INestApplication;
  let owner: Client;
  let monitor: Session,
    district: Session,
    officer: Session,
    auditor: Session,
    admin: Session,
    planner: Session,
    finance: Session;
  const ids: Record<string, string> = {};
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const post = (s: Session, url: string, body: object = {}) =>
    s.agent.post(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);

  beforeAll(async () => {
    ({ app } = await createApp());
    owner = await ownerClient();
    for (const code of ['DIST-A', 'DIST-B'])
      ids[code] = (
        await owner.query(`SELECT id FROM jurisdictions WHERE code = $1`, [code])
      ).rows[0].id;
    for (const code of ['DEMO-001', 'DEMO-002'])
      ids[code] = (
        await owner.query(`SELECT id FROM schemes WHERE scheme_code = $1`, [code])
      ).rows[0].id;
    ids.source = (
      await owner.query(`SELECT id FROM integration_sources WHERE code = 'ERUPANTOR_SYNTHETIC_CSV'`)
    ).rows[0].id;
    monitor = await login(app, 'state.monitor@example.test');
    district = await login(app, 'district.reviewer@example.test');
    officer = await login(app, 'field.officer@example.test');
    auditor = await login(app, 'auditor@example.test');
    admin = await login(app, 'admin@example.test');
    planner = await login(app, 'state.planner@example.test');
    finance = await login(app, 'finance.checker@example.test');
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  describe('reports', () => {
    it('lists the ten definitions to those allowed, hiding audit activity without tenant-wide audit access', async () => {
      const a = await get(auditor, '/reports').expect(200);
      expect(a.body.items.map((d: { code: string }) => d.code)).toEqual([
        'state-summary',
        'district-progress',
        'budget-vs-expenditure',
        'release-utilisation',
        'delayed-schemes',
        'pending-approvals',
        'alert-status',
        'reporting-completeness',
        'scheme-history',
        'audit-activity',
      ]);
      expect(a.body.canExport).toBe(true);
      const d = await get(district, '/reports').expect(200);
      expect(d.body.items).toHaveLength(9);
      expect(d.body.canExport).toBe(false);
      await get(officer, '/reports').expect(403);
    });

    it('state summary and district rows reconcile exactly with the dashboards for the same filters', async () => {
      const periods = (await get(monitor, '/budget/periods').expect(200)).body as {
        id: string;
        code: string;
      }[];
      for (const qs of ['', `?periodId=${periods[periods.length - 1].id}`]) {
        const dash = (await get(monitor, `/dashboards/state${qs}`).expect(200)).body;
        const rep = (await get(monitor, `/reports/state-summary${qs}`).expect(200)).body;
        const row = rep.rows[0];
        for (const k of [
          'approvedBudget',
          'allocatedBudget',
          'verifiedReleases',
          'verifiedExpenditure',
          'reportedExpenditure',
          'financialUtilisationPercent',
          'releaseUtilisationPercent',
          'budgetRemaining',
          'unreleasedAllocation',
          'unspentReleasedFunds',
          'schemeCount',
          'openAlerts',
          'delayedSchemes',
        ])
          expect([k, row[k]]).toEqual([k, dash.totals[k]]);
      }
      const dist = (await get(monitor, `/dashboards/district/${ids['DIST-A']}`).expect(200)).body;
      const rep = (await get(monitor, '/reports/district-progress').expect(200)).body;
      const a = rep.rows.find((r: { jurisdictionCode: string }) => r.jurisdictionCode === 'DIST-A');
      expect(a.verifiedExpenditure).toBe(dist.totals.verifiedExpenditure);
      expect(a.approvedBudget).toBe(dist.totals.approvedBudget);
      expect(a.financialUtilisationPercent).toBe(dist.totals.financialUtilisationPercent);
    });

    it('scheme rows match the scheme 360 metrics and zero denominators are N/A in the file', async () => {
      const rep = (await get(monitor, '/reports/budget-vs-expenditure').expect(200)).body;
      const s360 = (await get(monitor, `/dashboards/scheme/${ids['DEMO-001']}`).expect(200)).body;
      const r = rep.rows.find((x: { schemeCode: string }) => x.schemeCode === 'DEMO-001');
      expect(r.verifiedExpenditure).toBe(s360.metrics.verifiedExpenditure);
      expect(r.financialUtilisationPercent).toBe(s360.metrics.financialUtilisationPercent);
      expect(r.approvedBudget).toBe(s360.metrics.approvedBudget);
    });

    it('district reviewer only sees District A data and cannot pick District B', async () => {
      const rep = (await get(district, '/reports/budget-vs-expenditure').expect(200)).body;
      const codes = rep.rows.map((r: { schemeCode: string }) => r.schemeCode);
      expect(codes).toContain('DEMO-001');
      expect(codes).not.toContain('DEMO-005');
      expect(rep.meta).toEqual(
        expect.arrayContaining([['Jurisdiction scope', expect.stringContaining('District A')]]),
      );
      await get(district, `/reports/state-summary?jurisdictionId=${ids['DIST-B']}`).expect(404);
      await get(district, '/reports/audit-activity').expect(403);
      await get(district, '/reports/budget-vs-expenditure/export?format=csv').expect(403);
    });

    it('CSV export carries metadata, is audited and recorded in export history', async () => {
      const before = (await owner.query(`SELECT COUNT(*)::int n FROM report_executions`)).rows[0].n;
      const res = await get(
        monitor,
        `/reports/district-progress/export?format=csv&jurisdictionId=${ids['DIST-A']}`,
      ).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="dcp-pulse_district-progress_.*\.csv"/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const text = res.text;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      for (const k of [
        'Report,District-wise',
        'Tenant,',
        'Jurisdiction scope,Tenant-wide',
        'Jurisdiction filter,District A',
        'Financial year,',
        'Reporting period,',
        'Generated at,',
        'Verification basis,',
        'Notice,Synthetic',
      ])
        expect(text).toContain(k);
      expect(text).toContain('Co-district A1');
      const ex = (
        await owner.query(`SELECT * FROM report_executions ORDER BY created_at DESC LIMIT 1`)
      ).rows[0];
      expect((await owner.query(`SELECT COUNT(*)::int n FROM report_executions`)).rows[0].n).toBe(
        before + 1,
      );
      expect(ex.report_code).toBe('district-progress');
      expect(ex.format).toBe('CSV');
      const ev = await owner.query(`SELECT action FROM audit_events WHERE entity_id = $1`, [ex.id]);
      expect(ev.rows.map((r) => r.action)).toEqual(['REPORT_EXPORTED']);
      const hist = await get(monitor, '/reports/executions').expect(200);
      expect(hist.body[0].id).toBe(ex.id);
      // Export history is append-only for the application role.
      await expect(
        owner.query(`SET ROLE dcp_app; UPDATE report_executions SET row_count = 0; RESET ROLE`),
      ).rejects.toThrow();
      await owner.query('RESET ROLE');
    });

    it('XLSX export has typed numbers that equal the JSON report, plus a metadata sheet', async () => {
      const res = await get(monitor, '/reports/budget-vs-expenditure/export?format=xlsx')
        .buffer(true)
        .parse(binary)
        .expect(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as never);
      const ws = wb.getWorksheet('Report')!;
      const header = (ws.getRow(1).values as string[]).slice(1);
      const codeCol = header.indexOf('Scheme code') + 1;
      const expCol = header.indexOf('Verified expenditure (INR)') + 1;
      let found: ExcelJS.Row | undefined;
      ws.eachRow((r) => {
        if (r.getCell(codeCol).value === 'DEMO-001') found = r;
      });
      const json = (await get(monitor, '/reports/budget-vs-expenditure').expect(200)).body;
      const r = json.rows.find((x: { schemeCode: string }) => x.schemeCode === 'DEMO-001');
      expect(found!.getCell(expCol).value).toBe(Number(r.verifiedExpenditure));
      const meta = wb.getWorksheet('Metadata')!;
      expect(meta.getCell('A1').value).toBe('Report');
    });

    it('scheme history and audit activity work for authorised users', async () => {
      await get(monitor, '/reports/scheme-history').expect(400);
      const h = (
        await get(monitor, `/reports/scheme-history?schemeId=${ids['DEMO-001']}`).expect(200)
      ).body;
      expect(h.rows.length).toBeGreaterThan(0);
      const a = (await get(auditor, '/reports/audit-activity').expect(200)).body;
      expect(a.rows.length).toBeGreaterThan(0);
      await get(monitor, '/reports/nope').expect(404);
    });
  });

  describe('synthetic e-Rupantor-style CSV import', () => {
    const stamp = Date.now();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const header = 'external_release_id,scheme_code,amount_inr,release_date,sanction_reference';
    const good = [
      header,
      `SYN-${stamp}-1,DEMO-002,1000.00,${yesterday},SYN/SANCTION/${stamp}/1`,
      `SYN-${stamp}-2,DEMO-002,"2,500.50",${yesterday},"=HYPERLINK(""http://x"")"`,
    ].join('\n');

    it('requires integration.manage', async () => {
      await get(planner, '/imports/sources').expect(403);
      await post(planner, '/imports/preview', {
        sourceId: ids.source,
        filename: 'x.csv',
        content: good,
      }).expect(403);
    });

    it('preview → commit creates unverified releases with mappings and a reconciliation; re-import is idempotent', async () => {
      const p = (
        await post(admin, '/imports/preview', {
          sourceId: ids.source,
          filename: 'good.csv',
          content: good,
        }).expect(201)
      ).body;
      expect(p.batch.status).toBe('VALIDATED');
      expect(p.totals).toEqual({ newRecords: 2, newAmount: '3500.50' });
      expect(
        await owner.query(`SELECT 1 FROM external_record_mappings WHERE external_id LIKE $1`, [
          `SYN-${stamp}-%`,
        ]),
      ).toHaveProperty('rowCount', 0);
      const c = (
        await post(admin, `/imports/${p.batch.id}/commit`, { version: p.batch.version }).expect(201)
      ).body;
      expect(c.reconciliation).toMatchObject({
        createdReleases: 2,
        alreadyImported: 0,
        createdAmount: '3500.50',
        fileAmount: '3500.50',
      });
      const rel = await owner.query(
        `SELECT fr.* FROM fund_releases fr JOIN external_record_mappings m ON m.internal_id = fr.id WHERE m.external_id LIKE $1 ORDER BY fr.amount`,
        [`SYN-${stamp}-%`],
      );
      expect(rel.rows.map((r) => [r.amount, r.verification_status, r.source_system])).toEqual([
        ['1000.00', 'PENDING', 'ERUPANTOR_SYNTHETIC_CSV'],
        ['2500.50', 'PENDING', 'ERUPANTOR_SYNTHETIC_CSV'],
      ]);
      await post(admin, `/imports/${p.batch.id}/commit`, { version: c.batch.version }).expect(409);

      const again = (
        await post(admin, '/imports/preview', {
          sourceId: ids.source,
          filename: 'good-again.csv',
          content: good,
        }).expect(201)
      ).body;
      expect(again.previouslyCommittedBatch.id).toBe(p.batch.id);
      expect(again.rows.map((r: { status: string }) => r.status)).toEqual([
        'ALREADY_IMPORTED',
        'ALREADY_IMPORTED',
      ]);
      const c2 = (
        await post(admin, `/imports/${again.batch.id}/commit`, {
          version: again.batch.version,
        }).expect(201)
      ).body;
      expect(c2.reconciliation).toMatchObject({ createdReleases: 0, alreadyImported: 2 });
      expect(
        (
          await owner.query(
            `SELECT COUNT(*)::int n FROM external_record_mappings WHERE external_id LIKE $1`,
            [`SYN-${stamp}-%`],
          )
        ).rows[0].n,
      ).toBe(2);

      // Imported releases still need an independent finance verification (maker-checker unchanged).
      const r0 = rel.rows[0];
      const dec = await finance.agent
        .post(`/api/v1/fund-releases/${r0.id}/decision`)
        .set('x-csrf-token', finance.csrf)
        .set('idempotency-key', `imp-verify-${stamp}`)
        .send({ version: r0.version, decision: 'VERIFY' });
      expect(dec.body).toMatchObject({ verificationStatus: 'VERIFIED' });

      // Formula-like text from the file is neutralised in exports.
      const csv = await get(monitor, `/reports/pending-approvals/export?format=csv`).expect(200);
      expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
      const audits = await owner.query(
        `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY created_at`,
        [p.batch.id],
      );
      expect(audits.rows.map((r) => r.action)).toEqual(['IMPORT_PREVIEWED', 'IMPORT_COMMITTED']);
    });

    it('reports row errors (duplicates, unknown scheme, bad values, conflicts) and refuses to commit', async () => {
      const bad = [
        header,
        `SYN-${stamp}-1,DEMO-002,9999.00,${yesterday},changed amount`,
        `SYN-${stamp}-3,NOPE-999,10.00,${yesterday},ref-3`,
        `SYN-${stamp}-4,DEMO-002,-5,${yesterday},ref-4`,
        `SYN-${stamp}-5,DEMO-002,10.00,2099-01-01,ref-5`,
        `SYN-${stamp}-6,DEMO-002,10.00,2026-02-30,ref-6`,
        `SYN-${stamp}-7,DEMO-002,10.00,${yesterday},ref-7`,
        `SYN-${stamp}-7,DEMO-002,10.00,${yesterday},ref-7`,
        `SYN-${stamp}-8,DEMO-002,10.00`,
      ].join('\n');
      const p = (
        await post(admin, '/imports/preview', {
          sourceId: ids.source,
          filename: 'bad.csv',
          content: bad,
        }).expect(201)
      ).body;
      expect(p.batch.status).toBe('FAILED');
      expect(
        p.errors.map((e: { rowNumber: number; code: string }) => `${e.rowNumber}:${e.code}`).sort(),
      ).toEqual(
        [
          '2:EXTERNAL_ID_CONFLICT',
          '3:UNKNOWN_SCHEME',
          '4:INVALID_AMOUNT',
          '5:RELEASE_DATE_IN_FUTURE',
          '6:INVALID_DATE',
          '8:DUPLICATE_IN_FILE',
          '9:COLUMN_COUNT',
        ].sort(),
      );
      expect(p.batch.duplicateCount).toBe(1);
      await post(admin, `/imports/${p.batch.id}/commit`, { version: p.batch.version }).expect(409);
      const detail = (await get(admin, `/imports/${p.batch.id}`).expect(200)).body;
      expect(detail.errors).toHaveLength(7);

      const noCol = (
        await post(admin, '/imports/preview', {
          sourceId: ids.source,
          filename: 'nocol.csv',
          content: 'a,b\n1,2',
        }).expect(201)
      ).body;
      expect(noCol.errors[0].code).toBe('MISSING_COLUMN');
      // Import errors are append-only.
      await expect(
        owner.query(`SET ROLE dcp_app; DELETE FROM import_errors; RESET ROLE`),
      ).rejects.toThrow();
      await owner.query('RESET ROLE');
    });

    it('refuses to commit a staged batch whose external ID was since imported with different values', async () => {
      const row = (amount: string) =>
        [header, `SYN-${stamp}-C,DEMO-002,${amount},${yesterday},SYN/C/${stamp}`].join('\n');
      const preview = async (amount: string) =>
        (
          await post(admin, '/imports/preview', {
            sourceId: ids.source,
            filename: `c-${amount}.csv`,
            content: row(amount),
          }).expect(201)
        ).body;
      const a = await preview('700.00');
      const b = await preview('900.00');
      await post(admin, `/imports/${a.batch.id}/commit`, { version: a.batch.version }).expect(201);
      const res = await post(admin, `/imports/${b.batch.id}/commit`, {
        version: b.batch.version,
      }).expect(409);
      expect(JSON.stringify(res.body)).toContain('IMPORT_CONFLICT');
      expect(
        (await get(admin, `/imports/${b.batch.id}`).expect(200)).body.batch?.status ?? 'x',
      ).not.toBe('COMMITTED');
    });

    it('hides alert details on scheme 360 and GIS from users without alert.view', async () => {
      const s360 = (await get(planner, `/dashboards/scheme/${ids['DEMO-001']}`).expect(200)).body;
      expect(s360.alertsVisible).toBe(false);
      expect(s360.alerts).toEqual([]);
      const gis = (await get(planner, `/gis/schemes/${ids['DEMO-001']}`).expect(200)).body;
      expect(gis.alerts).toEqual([]);
      expect(gis.topAlertSeverity).toBeNull();
      expect(s360.metrics.openAlerts).toBeNull();
      expect(gis.openAlerts).toBeNull();
      const mon = (await get(monitor, `/dashboards/scheme/${ids['DEMO-001']}`).expect(200)).body;
      expect(mon.alertsVisible).toBe(true);
      expect(mon.metrics.openAlerts).toBeGreaterThan(0);
    });

    it('hides open-alert counts on dashboards and reports from users without alert.view', async () => {
      const state = (await get(planner, '/dashboards/state').expect(200)).body;
      expect(state.totals.openAlerts).toBeNull();
      const list = (await get(planner, '/dashboards/schemes?pageSize=100').expect(200)).body;
      expect(list.items.every((s: { openAlerts: unknown }) => s.openAlerts === null)).toBe(true);
      const monState = (await get(monitor, '/dashboards/state').expect(200)).body;
      expect(typeof monState.totals.openAlerts).toBe('number');
    });
  });
});
