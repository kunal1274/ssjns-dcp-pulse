import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from 'pg';
import type { CapturingMailSender } from '../../src/mail/mail.service';
import { ownerClient } from '../integration/db';
import { createApp, login, tokenFrom, unique, type Session } from './helpers';

const PW = 'Synthetic-Pass-2026';
let seq = 0;
const key = () => `f07-${Date.now()}-${++seq}`;

describe('F07–F09 releases, expenditure, progress and maker-checker (e2e, real database)', () => {
  let app: INestApplication;
  let mail: CapturingMailSender;
  let owner: Client;
  let admin: Session, finance: Session, officer: Session, district: Session, codistrict: Session;
  let dual: Session; // holds submit and verify permissions, to prove self-verification is refused
  let tenantId = '';
  let schemeA = ''; // CD-A1, fresh per run
  let schemeB = ''; // CD-B1, fresh per run
  const milestones: string[] = [];
  const periods: string[] = [];
  let foreignPeriod: string | undefined;

  const post = (s: Session, url: string, body: object, idem: string | null = key()) => {
    const r = s.agent.post(`/api/v1${url}`).set('x-csrf-token', s.csrf);
    return (idem ? r.set('Idempotency-Key', idem) : r).send(body);
  };
  const patch = (s: Session, url: string, body: object) =>
    s.agent.patch(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);

  const insertScheme = async (jurisdiction: string, code: string) => {
    const r = await owner.query(
      `INSERT INTO schemes (tenant_id, scheme_code, name, category, financial_year_id, agency_id, jurisdiction_id, status, start_date, target_end_date)
       SELECT s.tenant_id, $2, 'Synthetic F07 test scheme', s.category, s.financial_year_id, s.agency_id, j.id, 'ACTIVE', '2026-04-01', '2027-03-31'
       FROM schemes s JOIN jurisdictions j ON j.tenant_id = s.tenant_id AND j.code = $1
       WHERE s.scheme_code = 'DEMO-001' RETURNING id`,
      [jurisdiction, code],
    );
    return r.rows[0].id as string;
  };

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    owner = await ownerClient();
    tenantId = (await owner.query(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).rows[0].id;
    const stamp = Date.now().toString().slice(-9);
    schemeA = await insertScheme('CD-A1', `F7A-${stamp}`);
    schemeB = await insertScheme('CD-B1', `F7B-${stamp}`);
    for (const [name, qty, weight] of [
      ['Foundation', '10.000', '60.00'],
      ['Superstructure', '5.000', '40.00'],
    ] as const) {
      milestones.push(
        (
          await owner.query(
            `INSERT INTO scheme_milestones (tenant_id, scheme_id, name, target_date, target_quantity, unit, weight)
             VALUES ($1, $2, $3, '2027-01-31', $4, 'units', $5) RETURNING id`,
            [tenantId, schemeA, name, qty, weight],
          )
        ).rows[0].id,
      );
    }
    (
      await owner.query(
        `SELECT p.id FROM reporting_periods p JOIN schemes s ON s.financial_year_id = p.financial_year_id
         WHERE s.id = $1 ORDER BY p.start_date`,
        [schemeA],
      )
    ).rows.forEach((r) => periods.push(r.id));
    foreignPeriod = (
      await owner.query(
        `SELECT p.id FROM reporting_periods p WHERE p.tenant_id = $1
         AND p.financial_year_id <> (SELECT financial_year_id FROM schemes WHERE id = $2) LIMIT 1`,
        [tenantId, schemeA],
      )
    ).rows[0]?.id;

    admin = await login(app, 'admin@example.test');
    finance = await login(app, 'finance.reviewer@example.test');
    officer = await login(app, 'field.officer@example.test');
    district = await login(app, 'district.reviewer@example.test');
    codistrict = await login(app, 'codistrict.reviewer@example.test');

    const email = unique('dual');
    const inv = await post(
      admin,
      '/users/invite',
      { email, name: 'Synthetic dual-role user' },
      null,
    );
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: tokenFrom(mail.sent.at(-1)!.body), newPassword: PW })
      .expect(204);
    const roles = (await get(admin, '/roles')).body as { code: string; id: string }[];
    for (const code of ['IMPLEMENTING_OFFICER', 'FINANCE_REVIEWER', 'CO_DISTRICT_REVIEWER'])
      await post(
        admin,
        `/users/${inv.body.id}/role-scopes`,
        { roleId: roles.find((r) => r.code === code)!.id, scopeType: 'TENANT' },
        null,
      ).expect(201);
    dual = await login(app, email, PW);
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('F07 release: idempotent record → maker cannot verify → other finance user verifies → summary updates', async () => {
    const idem = key();
    const body = {
      schemeId: schemeA,
      amount: '700000.00',
      releaseDate: '2026-08-01',
      reference: 'SYN-REL-1',
    };
    const r = await post(finance, '/fund-releases', body, idem);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ verificationStatus: 'PENDING', amount: '700000.00' });
    const retry = await post(finance, '/fund-releases', body, idem);
    expect(retry.body.id).toBe(r.body.id);
    const count = await owner.query(
      `SELECT count(*)::int n FROM fund_releases WHERE scheme_id = $1`,
      [schemeA],
    );
    expect(count.rows[0].n).toBe(1);
    expect((await post(finance, '/fund-releases', body)).status).toBe(201); // new key → new record
    const second = (await get(finance, `/fund-releases?schemeId=${schemeA}`)).body.items.find(
      (x: { id: string }) => x.id !== r.body.id,
    );

    const self = await post(finance, `/fund-releases/${r.body.id}/decision`, {
      version: 1,
      decision: 'VERIFY',
    });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(
      (
        await post(officer, `/fund-releases/${r.body.id}/decision`, {
          version: 1,
          decision: 'VERIFY',
        })
      ).status,
    ).toBe(403);
    const stale = await post(dual, `/fund-releases/${r.body.id}/decision`, {
      version: 9,
      decision: 'VERIFY',
    });
    expect(stale.status).toBe(409);
    const ok = await post(dual, `/fund-releases/${r.body.id}/decision`, {
      version: 1,
      decision: 'VERIFY',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ verificationStatus: 'VERIFIED', version: 2 });
    const noReason = await post(dual, `/fund-releases/${second.id}/decision`, {
      version: 1,
      decision: 'REJECT',
    });
    expect(noReason.status).toBe(400);
    expect(
      (
        await post(dual, `/fund-releases/${second.id}/decision`, {
          version: 1,
          decision: 'REJECT',
          reason: 'Duplicate entry',
        })
      ).body.verificationStatus,
    ).toBe('REJECTED');

    const summary = await get(finance, `/schemes/${schemeA}/finance`);
    expect(summary.body).toMatchObject({ verifiedReleases: '700000.00', pendingReleases: '0.00' });
    const hist = await get(finance, `/fund-releases/${r.body.id}/decisions`);
    expect(hist.body.map((d: { decision: string }) => d.decision)).toEqual(['RECORDED', 'VERIFY']);
  });

  it('F07 expenditure: submit → return needs reason → resubmit → finance verifies; verified row immutable; correction supersedes (T09)', async () => {
    if (foreignPeriod) {
      const bad = await post(officer, '/expenditure', {
        schemeId: schemeA,
        periodId: foreignPeriod,
        amount: '1.00',
        expenditureDate: '2026-08-10',
        reference: 'SYN-X',
      });
      expect(bad.body.error).toBe('FINANCIAL_YEAR_MISMATCH');
    }
    const e = await post(officer, '/expenditure', {
      schemeId: schemeA,
      periodId: periods[4],
      amount: '300000.00',
      expenditureDate: '2026-08-10',
      reference: 'SYN-EXP-1',
    });
    expect(e.status).toBe(201);
    expect(e.body.status).toBe('SUBMITTED');
    expect(
      (
        await post(finance, `/expenditure/${e.body.id}/decision`, {
          version: 1,
          decision: 'RETURN',
        })
      ).status,
    ).toBe(400);
    const ret = await post(finance, `/expenditure/${e.body.id}/decision`, {
      version: 1,
      decision: 'RETURN',
      reason: 'Attach the bill reference',
    });
    expect(ret.body.status).toBe('RETURNED');
    expect((await post(dual, `/expenditure/${e.body.id}/resubmit`, { version: 2 })).status).toBe(
      409,
    ); // not the submitter
    const re = await post(officer, `/expenditure/${e.body.id}/resubmit`, {
      version: 2,
      amount: '350000.00',
      reference: 'SYN-EXP-1A',
    });
    expect(re.body).toMatchObject({ status: 'SUBMITTED', amount: '350000.00' });
    const v = await post(finance, `/expenditure/${e.body.id}/decision`, {
      version: 3,
      decision: 'VERIFY',
    });
    expect(v.body).toMatchObject({ status: 'VERIFIED' });

    await expect(
      owner.query(`UPDATE expenditure_records SET amount = 1 WHERE id = $1`, [e.body.id]),
    ).rejects.toThrow(/VERIFIED_RECORD_IMMUTABLE/);
    const reason = 'Bill total re-checked against ledger';
    const c = await post(officer, `/expenditure/${e.body.id}/corrections`, {
      amount: '340000.00',
      reason,
    });
    expect(c.body).toMatchObject({
      status: 'SUBMITTED',
      supersedesId: e.body.id,
      correctionReason: reason,
    });
    const dup = await post(officer, `/expenditure/${e.body.id}/corrections`, {
      amount: '1.00',
      reason,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CORRECTION_EXISTS');
    // Before the correction is verified, the original still counts.
    expect((await get(finance, `/schemes/${schemeA}/finance`)).body).toMatchObject({
      verifiedExpenditure: '350000.00',
      reportedUnverifiedExpenditure: '340000.00',
    });
    await post(finance, `/expenditure/${c.body.id}/decision`, {
      version: 1,
      decision: 'VERIFY',
    }).expect(201);
    const s = (await get(finance, `/schemes/${schemeA}/finance`)).body;
    expect(s).toMatchObject({
      verifiedExpenditure: '340000.00',
      releaseBalance: '360000.00',
      releaseUtilisationPercent: '48.57',
    });
    const original = await owner.query(
      `SELECT status, amount::text FROM expenditure_records WHERE id = $1`,
      [e.body.id],
    );
    expect(original.rows[0]).toEqual({ status: 'VERIFIED', amount: '350000.00' });
    const hist = await get(finance, `/expenditure/${e.body.id}/decisions`);
    expect(hist.body.map((d: { decision: string }) => d.decision)).toEqual([
      'SUBMITTED',
      'RETURN',
      'RESUBMITTED',
      'VERIFY',
    ]);
  });

  it('F09 maker-checker: a user holding submit and verify cannot verify their own expenditure; DB refuses it too', async () => {
    const e = await post(dual, '/expenditure', {
      schemeId: schemeA,
      periodId: periods[5],
      amount: '1000.00',
      expenditureDate: '2026-09-10',
      reference: 'SYN-SELF',
    });
    expect(e.status).toBe(201);
    const self = await post(dual, `/expenditure/${e.body.id}/decision`, {
      version: 1,
      decision: 'VERIFY',
    });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    const row = await owner.query(
      `SELECT status, submitted_by FROM expenditure_records WHERE id = $1`,
      [e.body.id],
    );
    expect(row.rows[0].status).toBe('SUBMITTED');
    await expect(
      owner.query(
        `UPDATE expenditure_records SET status='VERIFIED', verified_by = submitted_by, verified_at = now() WHERE id = $1`,
        [e.body.id],
      ),
    ).rejects.toThrow(/maker_checker/);
    const queue = (await get(dual, '/verification-queue')).body.items.map(
      (i: { id: string }) => i.id,
    );
    expect(queue).not.toContain(e.body.id);
    expect(
      (await get(finance, '/verification-queue')).body.items.map((i: { id: string }) => i.id),
    ).toContain(e.body.id);
  });

  it('F08 progress: draft → submit (T04 KPI unchanged) → review → return → resubmit → verify (T06) → immutable → correction', async () => {
    const before = (await get(officer, `/schemes/${schemeA}/progress`)).body;
    expect(before.physicalCompletionPercent).toBe('0.00');
    const d = await post(officer, '/progress-submissions', {
      schemeId: schemeA,
      periodId: periods[6],
      remarks: 'Synthetic site visit',
      measurements: [
        { milestoneId: milestones[0], quantityCompleted: '5.000' },
        { milestoneId: milestones[1], quantityCompleted: '5.000' },
      ],
    });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ status: 'DRAFT', submissionVersion: 1 });
    const dupe = await post(officer, '/progress-submissions', {
      schemeId: schemeA,
      periodId: periods[6],
      measurements: [],
    });
    expect(dupe.body.error).toBe('SUBMISSION_EXISTS');
    const sub = await post(officer, `/progress-submissions/${d.body.id}/submit`, { version: 1 });
    expect(sub.body.status).toBe('SUBMITTED');
    expect(
      (await get(officer, `/schemes/${schemeA}/progress`)).body.physicalCompletionPercent,
    ).toBe('0.00');

    expect(
      (await post(officer, `/progress-submissions/${d.body.id}/verify`, { version: 2 })).status,
    ).toBe(403);
    const rev = await post(codistrict, `/progress-submissions/${d.body.id}/start-review`, {
      version: 2,
    });
    expect(rev.body.status).toBe('UNDER_REVIEW');
    const ret = await post(codistrict, `/progress-submissions/${d.body.id}/return`, {
      version: 3,
      reason: 'Foundation count looks high',
    });
    expect(ret.body).toMatchObject({
      status: 'RETURNED',
      decisionReason: 'Foundation count looks high',
    });
    const upd = await patch(officer, `/progress-submissions/${d.body.id}`, {
      version: 4,
      measurements: [
        { milestoneId: milestones[0], quantityCompleted: '4.000' },
        { milestoneId: milestones[1], quantityCompleted: '5.000' },
      ],
    });
    expect(upd.status).toBe(200);
    const resub = await post(officer, `/progress-submissions/${d.body.id}/submit`, { version: 5 });
    expect(resub.body.status).toBe('RESUBMITTED');
    const ver = await post(district, `/progress-submissions/${d.body.id}/verify`, { version: 6 });
    expect(ver.body).toMatchObject({ status: 'VERIFIED' });
    // 60 × 4/10 + 40 × 5/5 = 64% weighted physical completion.
    const after = (await get(district, `/schemes/${schemeA}/progress`)).body;
    expect(after.physicalCompletionPercent).toBe('64.00');

    expect(
      (await patch(officer, `/progress-submissions/${d.body.id}`, { version: 7, remarks: 'x' }))
        .status,
    ).toBe(409);
    await expect(
      owner.query(
        `UPDATE progress_measurements SET quantity_completed = 9 WHERE submission_id = $1`,
        [d.body.id],
      ),
    ).rejects.toThrow();
    const corr = await post(officer, `/progress-submissions/${d.body.id}/corrections`, {});
    expect(corr.body).toMatchObject({
      status: 'DRAFT',
      submissionVersion: 2,
      supersedesId: d.body.id,
    });
    const detail = (await get(district, `/progress-submissions/${d.body.id}`)).body;
    expect(detail.history.map((h: { decision: string }) => h.decision)).toEqual([
      'CREATED',
      'SUBMITTED',
      'REVIEW_STARTED',
      'RETURNED',
      'RESUBMITTED',
      'VERIFIED',
    ]);
  });

  it('F09 progress: submitter holding progress.verify cannot verify own submission (T05)', async () => {
    const d = await post(dual, '/progress-submissions', {
      schemeId: schemeA,
      periodId: periods[7],
      measurements: [{ milestoneId: milestones[0], quantityCompleted: '6.000' }],
    });
    await post(dual, `/progress-submissions/${d.body.id}/submit`, { version: 1 }).expect(201);
    const self = await post(dual, `/progress-submissions/${d.body.id}/verify`, { version: 2 });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await get(dual, `/progress-submissions/${d.body.id}`)).body.status).toBe('SUBMITTED');
  });

  it('T07 jurisdiction isolation: CD-A1 and DIST-A reviewers cannot see or decide CD-B1 records', async () => {
    const rel = await post(finance, '/fund-releases', {
      schemeId: schemeB,
      amount: '5000.00',
      releaseDate: '2026-08-01',
      reference: 'SYN-B',
    });
    expect(rel.status).toBe(201);
    expect((await get(codistrict, `/schemes/${schemeB}/finance`)).status).toBe(404);
    expect((await get(district, `/schemes/${schemeB}/progress`)).status).toBe(404);
    expect((await get(district, `/fund-releases/${rel.body.id}/decisions`)).status).toBe(404);
    const list = (await get(district, `/fund-releases?schemeId=${schemeB}`)).body;
    expect(list.total).toBe(0);
    const officerB = await post(officer, '/progress-submissions', {
      schemeId: schemeB,
      periodId: periods[0],
      measurements: [],
    });
    expect(officerB.status).toBe(201); // field officer is scoped to DIST-A and DIST-B
    await post(officer, `/progress-submissions/${officerB.body.id}/submit`, { version: 1 }).expect(
      400,
    ); // needs a measurement
    expect(
      (
        await post(codistrict, `/progress-submissions/${officerB.body.id}/return`, {
          version: 1,
          reason: 'n/a',
        })
      ).status,
    ).toBe(404);
    expect(
      (await get(codistrict, '/verification-queue')).body.items.some(
        (i: { scheme: { id: string } }) => i.scheme.id === schemeB,
      ),
    ).toBe(false);
  });

  it('T10 seeded DEMO-001: 55% budget utilisation, 40% physical completion', async () => {
    const id = (await owner.query(`SELECT id FROM schemes WHERE scheme_code = 'DEMO-001'`)).rows[0]
      .id;
    const fin = (await get(finance, `/schemes/${id}/finance`)).body;
    const prog = (await get(finance, `/schemes/${id}/progress`)).body;
    expect(fin).toMatchObject({
      approvedBudget: '10000000.00',
      verifiedReleases: '7000000.00',
      verifiedExpenditure: '5500000.00',
      budgetUtilisationPercent: '55.00',
    });
    expect(prog.physicalCompletionPercent).toBe('40.00');
  });
});
