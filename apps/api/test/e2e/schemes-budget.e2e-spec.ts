import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from 'pg';
import type { CapturingMailSender } from '../../src/mail/mail.service';
import { ownerClient } from '../integration/db';
import { createApp, login, tokenFrom, unique, type Session } from './helpers';

const PW = 'Synthetic-Pass-2026';
let seq = 0;
const key = () => `test-${Date.now()}-${++seq}`;

describe('F06 scheme registry, budget ceilings and allocations (e2e, real database)', () => {
  let app: INestApplication;
  let mail: CapturingMailSender;
  let owner: Client;
  let admin: Session,
    planner: Session,
    approver: Session,
    district: Session,
    codistrict: Session,
    auditor: Session;
  const j: Record<string, string> = {};
  let fyId = '';
  let agencyId = '';
  let schemeId = '';

  const post = (s: Session, url: string, body: object, idem?: string) => {
    const r = s.agent.post(`/api/v1${url}`).set('x-csrf-token', s.csrf);
    return (idem ? r.set('Idempotency-Key', idem) : r).send(body);
  };
  const patch = (s: Session, url: string, body: object) =>
    s.agent.patch(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    owner = await ownerClient();
    const t = (await owner.query(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).rows[0].id;
    (
      await owner.query(`SELECT code, id FROM jurisdictions WHERE tenant_id = $1`, [t])
    ).rows.forEach((r) => (j[r.code] = r.id));
    agencyId = (
      await owner.query(`SELECT id FROM agencies WHERE tenant_id = $1 ORDER BY code LIMIT 1`, [t])
    ).rows[0].id;
    // A dedicated financial year keeps each run independent of earlier runs.
    const code = `T${Date.now()}`.slice(0, 20);
    fyId = (
      await owner.query(
        `INSERT INTO financial_years (tenant_id, code, start_date, end_date, status, updated_at) VALUES ($1, $2, '2027-04-01', '2028-03-31', 'PLANNED', now()) RETURNING id`,
        [t, code],
      )
    ).rows[0].id;

    admin = await login(app, 'admin@example.test');
    planner = await login(app, 'state.planner@example.test');
    district = await login(app, 'district.reviewer@example.test');
    codistrict = await login(app, 'codistrict.reviewer@example.test');
    auditor = await login(app, 'auditor@example.test');
    // Second state planner acts as checker for maker-checker flows.
    const email = unique('checker');
    const inv = await post(admin, '/users/invite', { email, name: 'Synthetic Budget Checker' });
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: tokenFrom(mail.sent.at(-1)!.body), newPassword: PW })
      .expect(204);
    const roles = await get(admin, '/roles');
    const plannerRole = roles.body.find((r: { code: string }) => r.code === 'STATE_PLANNER').id;
    await post(admin, `/users/${inv.body.id}/role-scopes`, {
      roleId: plannerRole,
      scopeType: 'TENANT',
    }).expect(201);
    approver = await login(app, email, PW);
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('scheme lifecycle: create → submit → maker cannot approve → checker approves → appears in register', async () => {
    const code = `T-${Date.now()}`.slice(0, 20);
    const created = await post(planner, '/schemes', {
      schemeCode: code,
      name: 'Synthetic test footbridge',
      category: 'Infrastructure',
      financialYearId: fyId,
      agencyId,
      jurisdictionId: j['CD-A1'],
      department: 'Synthetic PWD',
      proposedBudget: '250000.00',
      startDate: '2027-04-10',
      targetEndDate: '2028-03-01',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      proposedBudget: '250000.00',
      approvedBudget: null,
    });
    schemeId = created.body.id;
    expect(
      (
        await post(planner, '/schemes', {
          ...created.body,
          schemeCode: code,
          financialYearId: fyId,
          agencyId,
          jurisdictionId: j['CD-A1'],
          id: undefined,
        })
      ).status,
    ).toBe(400);

    const sub = await post(planner, `/schemes/${schemeId}/submit`, {
      version: created.body.version,
    });
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('SUBMITTED');
    const self = await post(planner, `/schemes/${schemeId}/decision`, {
      version: sub.body.version,
      decision: 'APPROVE',
    });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    const ok = await post(approver, `/schemes/${schemeId}/decision`, {
      version: sub.body.version,
      decision: 'APPROVE',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'APPROVED', approvedBudget: '250000.00' });
    expect(
      (await patch(planner, `/schemes/${schemeId}`, { version: ok.body.version, name: 'Edited' }))
        .status,
    ).toBe(409);
    const suspend = await post(approver, `/schemes/${schemeId}/transition`, {
      version: ok.body.version,
      to: 'COMPLETED',
    });
    expect(suspend.status).toBe(409);
    const active = await post(approver, `/schemes/${schemeId}/transition`, {
      version: ok.body.version,
      to: 'ACTIVE',
    });
    expect(active.body.status).toBe('ACTIVE');
    expect(
      (
        await post(approver, `/schemes/${schemeId}/transition`, {
          version: active.body.version,
          to: 'SUSPENDED',
        })
      ).status,
    ).toBe(400);

    const reg = await get(district, `/schemes?q=${code}`);
    expect(reg.body.items.map((s: { id: string }) => s.id)).toEqual([schemeId]);
    const audits = await owner.query(
      `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`,
      [schemeId],
    );
    expect(audits.rows.map((r) => r.action)).toEqual([
      'SCHEME_CREATED',
      'SCHEME_SUBMITTED',
      'SCHEME_APPROVED',
      'SCHEME_STATUS_CHANGED',
    ]);
  });

  it('District A cannot read District B; co-district cannot act outside scope', async () => {
    const all = await get(planner, '/schemes?pageSize=100');
    const inB = all.body.items.find((s: { jurisdiction: { code: string } }) =>
      s.jurisdiction.code.startsWith('CD-B'),
    );
    const inA2 = all.body.items.find(
      (s: { jurisdiction: { code: string } }) => s.jurisdiction.code === 'CD-A2',
    );
    const mine = await get(district, '/schemes?pageSize=100');
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(
      mine.body.items.every((s: { jurisdiction: { code: string } }) =>
        ['DIST-A', 'CD-A1', 'CD-A2'].includes(s.jurisdiction.code),
      ),
    ).toBe(true);
    expect((await get(district, `/schemes/${inB.id}`)).status).toBe(404);
    expect((await get(codistrict, `/schemes/${inA2.id}`)).status).toBe(404);
    const created = await post(codistrict, '/schemes', {
      schemeCode: 'X-NOPE-1',
      name: 'Nope scheme',
      category: 'X',
      financialYearId: fyId,
      agencyId,
      jurisdictionId: j['CD-A1'],
    });
    expect(created.status).toBe(403);
    const req = await post(
      codistrict,
      '/budget/requests',
      {
        schemeId: inA2.id,
        periodId: (await get(planner, '/budget/periods')).body[0].id,
        amount: '1000.00',
        justification: 'Outside my co-district scope',
      },
      key(),
    );
    expect(req.status).toBe(404);
  });

  it('auditor cannot create or change financial records', async () => {
    expect(
      (
        await post(
          auditor,
          '/budget/ceilings',
          { financialYearId: fyId, jurisdictionId: j['AS-DEMO'], totalAmount: '1.00' },
          key(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          auditor,
          '/budget/allocations',
          { budgetVersionId: fyId, recipientJurisdictionId: j['DIST-A'], amount: '1.00' },
          key(),
        )
      ).status,
    ).toBe(403);
    expect((await patch(auditor, `/schemes/${schemeId}`, { version: 1, name: 'x' })).status).toBe(
      403,
    );
    expect((await get(auditor, '/schemes')).status).toBe(200);
  });

  it('financial years: tenant-wide planner can configure; scoped or unauthorised users cannot', async () => {
    const code = `FY${Date.now()}`.slice(0, 20);
    // Years cannot overlap, so start after the latest year already configured.
    const years: { endDate: string }[] = (await get(planner, '/budget/financial-years')).body;
    const y = Math.max(2040, ...years.map((f) => new Date(f.endDate).getUTCFullYear()));
    const body = { code, startDate: `${y}-04-01`, endDate: `${y + 1}-03-31` };
    const created = await post(planner, '/budget/financial-years', body).expect(201);
    expect(created.body).toMatchObject({ code, status: 'PLANNED' });
    expect((await post(planner, '/budget/financial-years', body).expect(409)).body.error).toBe(
      'FINANCIAL_YEAR_EXISTS',
    );
    const overlap = await post(planner, '/budget/financial-years', {
      code: `${code}O`.slice(0, 20),
      startDate: `${y}-10-01`,
      endDate: `${y + 1}-09-30`,
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toBe('FINANCIAL_YEAR_OVERLAP');
    const periods = (await get(planner, '/budget/periods')).body.filter(
      (p: { financialYearId: string }) => p.financialYearId === created.body.id,
    );
    expect(periods).toHaveLength(12);
    expect(periods[0].code).toBe(`${y}-04`);
    expect(periods[11].code).toBe(`${y + 1}-03`);
    await post(planner, '/budget/financial-years', {
      code: `${code}X`.slice(0, 20),
      startDate: `${y + 5}-04-01`,
      endDate: `${y + 5}-03-31`,
    }).expect(400);
    await post(district, '/budget/financial-years', { ...body, code: `${code}D` }).expect(403);
    await post(auditor, '/budget/financial-years', { ...body, code: `${code}A` }).expect(403);
    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'FINANCIAL_YEAR_CREATED' AND entity_id = $1`,
      [created.body.id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('scheme edits cannot leave the end date before the start date', async () => {
    const d = await post(planner, '/schemes', {
      schemeCode: `D-${Date.now()}`.slice(0, 20),
      name: 'Synthetic date-check scheme',
      category: 'Infrastructure',
      financialYearId: fyId,
      agencyId,
      jurisdictionId: j['CD-A1'],
      proposedBudget: '1000.00',
      startDate: '2027-04-10',
      targetEndDate: '2028-03-01',
    }).expect(201);
    const bad = await patch(planner, `/schemes/${d.body.id}`, {
      version: d.body.version,
      targetEndDate: '2027-03-01',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_DATES');
    await patch(planner, `/schemes/${d.body.id}`, {
      version: d.body.version,
      targetEndDate: '2027-12-31',
    }).expect(200);
  });

  it('seeded schemes count a district allocation and its co-district child once', async () => {
    const all = (await get(planner, '/schemes?pageSize=100&q=DEMO-001')).body.items;
    const demo = all.find((x: { schemeCode: string }) => x.schemeCode === 'DEMO-001');
    expect(demo.approvedBudget).toBe('10000000.00');
    expect(demo.allocatedAmount).toBe('10000000.00');
  });

  describe('budget hierarchy', () => {
    let ceiling: { id: string; version: number };
    let distA: { id: string; version: number };
    let cdA1: { id: string };

    const remaining = async () =>
      (await get(planner, `/budget/ceilings?financialYearId=${fyId}`)).body[0];

    it('ceiling → district → co-district → scheme with maker-checker and server-side balances', async () => {
      expect(
        (
          await post(planner, '/budget/ceilings', {
            financialYearId: fyId,
            jurisdictionId: j['AS-DEMO'],
            totalAmount: '1000000.00',
          })
        ).body.error,
      ).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const c = await post(
        planner,
        '/budget/ceilings',
        { financialYearId: fyId, jurisdictionId: j['AS-DEMO'], totalAmount: '1000000.00' },
        key(),
      );
      expect(c.status).toBe(201);
      expect(
        (
          await post(
            planner,
            `/budget/ceilings/${c.body.id}/approve`,
            { version: c.body.version },
            key(),
          )
        ).status,
      ).toBe(403);
      const ca = await post(
        approver,
        `/budget/ceilings/${c.body.id}/approve`,
        { version: c.body.version },
        key(),
      );
      expect(ca.body).toMatchObject({ status: 'APPROVED', remaining: '1000000.00' });
      ceiling = ca.body;

      const a = await post(
        planner,
        '/budget/allocations',
        { budgetVersionId: ceiling.id, recipientJurisdictionId: j['DIST-A'], amount: '600000.00' },
        key(),
      );
      expect(a.status).toBe(201);
      expect(await remaining()).toMatchObject({
        remaining: '1000000.00',
        allocatedPending: '600000.00',
        available: '400000.00',
      });
      expect(
        (
          await post(
            planner,
            `/budget/allocations/${a.body.id}/approve`,
            { version: a.body.version },
            key(),
          )
        ).body.error,
      ).toBe('SELF_APPROVAL_FORBIDDEN');
      const stale = await post(
        approver,
        `/budget/allocations/${a.body.id}/approve`,
        { version: a.body.version + 5 },
        key(),
      );
      expect(stale.status).toBe(409);
      const aa = await post(
        approver,
        `/budget/allocations/${a.body.id}/approve`,
        { version: a.body.version },
        key(),
      );
      expect(aa.body.status).toBe('APPROVED');
      distA = aa.body;
      expect(await remaining()).toMatchObject({
        remaining: '400000.00',
        allocatedApproved: '600000.00',
      });

      const sub = await post(
        planner,
        '/budget/allocations',
        {
          budgetVersionId: ceiling.id,
          parentAllocationId: distA.id,
          recipientJurisdictionId: j['CD-A1'],
          amount: '250000.00',
        },
        key(),
      );
      const suba = await post(
        approver,
        `/budget/allocations/${sub.body.id}/approve`,
        { version: sub.body.version },
        key(),
      );
      cdA1 = suba.body;
      const leaf = await post(
        planner,
        '/budget/allocations',
        {
          budgetVersionId: ceiling.id,
          parentAllocationId: cdA1.id,
          recipientJurisdictionId: j['CD-A1'],
          schemeId,
          amount: '100000.00',
        },
        key(),
      );
      expect(leaf.status).toBe(201);
      expect(leaf.body.level).toBe('SCHEME');
      await post(
        approver,
        `/budget/allocations/${leaf.body.id}/approve`,
        { version: leaf.body.version },
        key(),
      ).expect(201);

      const list = (await get(planner, `/budget/allocations?budgetVersionId=${ceiling.id}`)).body;
      const byId = (id: string) => list.find((x: { id: string }) => x.id === id);
      expect(byId(distA.id)).toMatchObject({ amount: '600000.00', remaining: '350000.00' });
      expect(byId(cdA1.id)).toMatchObject({ amount: '250000.00', remaining: '150000.00' });
      // No double counting: the ceiling only sees the top-level district allocation.
      expect(await remaining()).toMatchObject({ remaining: '400000.00' });
      expect((await get(planner, `/schemes/${schemeId}`)).body.allocatedAmount).toBe('100000.00');
      const audits = await owner.query(
        `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`,
        [distA.id],
      );
      expect(audits.rows.map((r) => r.action)).toEqual([
        'BUDGET_ALLOCATION_CREATED',
        'BUDGET_ALLOCATION_APPROVED',
      ]);
    });

    it('rejects over-allocation without changing balances, and allocations outside the parent', async () => {
      const before = await remaining();
      const over = await post(
        planner,
        '/budget/allocations',
        { budgetVersionId: ceiling.id, recipientJurisdictionId: j['DIST-B'], amount: '400000.01' },
        key(),
      );
      expect(over.status).toBe(422);
      expect(over.body.error).toBe('ALLOCATION_EXCEEDS_AVAILABLE');
      expect(await remaining()).toEqual(before);
      const wrong = await post(
        planner,
        '/budget/allocations',
        {
          budgetVersionId: ceiling.id,
          parentAllocationId: distA.id,
          recipientJurisdictionId: j['CD-B1'],
          amount: '1.00',
        },
        key(),
      );
      expect(wrong.body.error).toBe('RECIPIENT_OUTSIDE_PARENT');
      const bad = await post(
        planner,
        '/budget/allocations',
        { budgetVersionId: ceiling.id, recipientJurisdictionId: j['DIST-B'], amount: '1.001' },
        key(),
      );
      expect(bad.status).toBe(400);
    });

    it('idempotency keys replay the first response and reject reuse with a different body', async () => {
      const k = key();
      const body = {
        budgetVersionId: ceiling.id,
        recipientJurisdictionId: j['DIST-B'],
        amount: '1000.00',
      };
      const first = await post(planner, '/budget/allocations', body, k);
      const again = await post(planner, '/budget/allocations', body, k);
      expect(again.body.id).toBe(first.body.id);
      const n = await owner.query(
        `SELECT count(*)::int AS n FROM budget_allocations WHERE budget_version_id = $1 AND status = 'DRAFT'`,
        [ceiling.id],
      );
      expect(n.rows[0].n).toBe(1);
      expect(
        (await post(planner, '/budget/allocations', { ...body, amount: '2000.00' }, k)).body.error,
      ).toBe('IDEMPOTENCY_KEY_REUSED');
      await post(planner, `/budget/allocations/${first.body.id}/cancel`, {
        version: first.body.version,
        reason: 'test cleanup',
      }).expect(201);
    });

    it('concurrent allocations cannot jointly exceed the available balance', async () => {
      const body = {
        budgetVersionId: ceiling.id,
        recipientJurisdictionId: j['DIST-B'],
        amount: '300000.00',
      };
      const results = await Promise.all([
        post(planner, '/budget/allocations', body, key()),
        post(planner, '/budget/allocations', body, key()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      const okOne = results.find((r) => r.status === 201)!;
      await post(planner, `/budget/allocations/${okOne.body.id}/cancel`, {
        version: okOne.body.version,
        reason: 'test cleanup',
      }).expect(201);
    });

    it('scheme allocations must come from a budget in the scheme financial year', async () => {
      const seeded = (
        await owner.query(
          `SELECT id FROM schemes WHERE scheme_code LIKE 'DEMO-%' AND jurisdiction_id = $1 AND status IN ('APPROVED', 'ACTIVE') LIMIT 1`,
          [j['CD-A1']],
        )
      ).rows[0].id;
      const r = await post(
        planner,
        '/budget/allocations',
        {
          budgetVersionId: ceiling.id,
          parentAllocationId: cdA1.id,
          recipientJurisdictionId: j['CD-A1'],
          schemeId: seeded,
          amount: '1.00',
        },
        key(),
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('FINANCIAL_YEAR_MISMATCH');
    });

    it('revisions are limited to the reviewer jurisdiction (list, request and decide)', async () => {
      const email = unique('reviser');
      const inv = await post(admin, '/users/invite', { email, name: 'Synthetic District Reviser' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: tokenFrom(mail.sent.at(-1)!.body), newPassword: PW })
        .expect(204);
      const roles = await get(admin, '/roles');
      const plannerRole = roles.body.find((r: { code: string }) => r.code === 'STATE_PLANNER').id;
      await post(admin, `/users/${inv.body.id}/role-scopes`, {
        roleId: plannerRole,
        scopeType: 'JURISDICTION',
        scopeId: j['DIST-A'],
        includeDescendants: true,
      }).expect(201);
      const reviser = await login(app, email, PW);
      const seededBudget = async (district: string) =>
        (
          await owner.query(
            `SELECT bv.id FROM budget_versions bv JOIN schemes s ON s.id = bv.scheme_id JOIN jurisdictions jj ON jj.id = s.jurisdiction_id
             WHERE bv.status = 'APPROVED' AND s.scheme_code LIKE 'DEMO-%' AND $1::uuid = ANY(jj.ancestry) LIMIT 1`,
            [district],
          )
        ).rows[0].id as string;

      const ceilingRev = await post(
        planner,
        '/budget/revisions',
        {
          targetType: 'BUDGET_VERSION',
          targetId: ceiling.id,
          requestedAmount: '1000001.00',
          reason: 'Synthetic state-level change',
        },
        key(),
      ).expect(201);
      const listed = (await get(reviser, '/budget/revisions')).body.map(
        (r: { id: string }) => r.id,
      );
      expect(listed).not.toContain(ceilingRev.body.id);
      const decide = await post(
        reviser,
        `/budget/revisions/${ceilingRev.body.id}/decision`,
        { decision: 'APPROVE' },
        key(),
      );
      expect(decide.status).toBe(404);

      const outside = await post(
        reviser,
        '/budget/revisions',
        {
          targetType: 'BUDGET_VERSION',
          targetId: await seededBudget(j['DIST-B']),
          requestedAmount: '1.00',
          reason: 'Synthetic out-of-scope change',
        },
        key(),
      );
      expect(outside.status).toBe(404);
      const inside = await post(
        reviser,
        '/budget/revisions',
        {
          targetType: 'BUDGET_VERSION',
          targetId: await seededBudget(j['DIST-A']),
          requestedAmount: '1.00',
          reason: 'Synthetic in-scope change',
        },
        key(),
      ).expect(201);
      expect(
        (await get(reviser, '/budget/revisions')).body.map((r: { id: string }) => r.id),
      ).toContain(inside.body.id);
      // Leave nothing pending so later runs can revise the same records.
      for (const id of [ceilingRev.body.id, inside.body.id])
        await post(
          approver,
          `/budget/revisions/${id}/decision`,
          { decision: 'REJECT', comment: 'test cleanup' },
          key(),
        ).expect(201);
    });

    it('revisions need a different approver and cannot go below sub-allocations', async () => {
      const low = await post(
        planner,
        '/budget/revisions',
        {
          targetType: 'ALLOCATION',
          targetId: distA.id,
          requestedAmount: '200000.00',
          reason: 'Synthetic cut',
        },
        key(),
      );
      expect(low.status).toBe(201);
      expect(
        (
          await post(
            planner,
            '/budget/revisions',
            {
              targetType: 'ALLOCATION',
              targetId: distA.id,
              requestedAmount: '1.00',
              reason: 'dup',
            },
            key(),
          )
        ).body.error,
      ).toBe('REVISION_PENDING');
      expect(
        (
          await post(
            planner,
            `/budget/revisions/${low.body.id}/decision`,
            { decision: 'APPROVE' },
            key(),
          )
        ).body.error,
      ).toBe('SELF_APPROVAL_FORBIDDEN');
      expect(
        (
          await post(
            approver,
            `/budget/revisions/${low.body.id}/decision`,
            { decision: 'APPROVE' },
            key(),
          )
        ).body.error,
      ).toBe('REVISION_BELOW_ALLOCATED');
      await post(
        approver,
        `/budget/revisions/${low.body.id}/decision`,
        { decision: 'REJECT', comment: 'below sub-allocations' },
        key(),
      ).expect(201);
      const up = await post(
        planner,
        '/budget/revisions',
        {
          targetType: 'ALLOCATION',
          targetId: distA.id,
          requestedAmount: '700000.00',
          reason: 'Synthetic top-up',
        },
        key(),
      );
      const done = await post(
        approver,
        `/budget/revisions/${up.body.id}/decision`,
        { decision: 'APPROVE' },
        key(),
      );
      expect(done.body.status).toBe('APPROVED');
      expect(await remaining()).toMatchObject({ remaining: '300000.00' });
      const hist = await get(planner, `/budget/allocations/${distA.id}/history`);
      expect(hist.body.revisions.map((r: { status: string }) => r.status)).toEqual([
        'REJECTED',
        'APPROVED',
      ]);
    });
  });

  it('bottom-up funding requests: submitter cannot review own request; reviewer can', async () => {
    const mine = (await get(district, '/schemes?pageSize=100')).body.items.find(
      (x: { jurisdiction: { code: string } }) => x.jurisdiction.code === 'CD-A2',
    );
    const periods: { id: string; financialYearId: string }[] = (
      await get(planner, '/budget/periods')
    ).body;
    const period = periods.find((p) => p.financialYearId === mine.financialYear.id)!.id;
    const wrongYear = periods.find((p) => p.financialYearId !== mine.financialYear.id)!.id;
    const mismatch = await post(
      district,
      '/budget/requests',
      { schemeId: mine.id, periodId: wrongYear, amount: '1.00', justification: 'Wrong year' },
      key(),
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe('FINANCIAL_YEAR_MISMATCH');
    const r = await post(
      district,
      '/budget/requests',
      {
        schemeId: mine.id,
        periodId: period,
        amount: '50000.00',
        justification: 'Synthetic next-quarter request',
      },
      key(),
    );
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('SUBMITTED');
    expect(
      (
        await post(
          district,
          `/budget/requests/${r.body.id}/review`,
          { version: r.body.version, decision: 'APPROVED' },
          key(),
        )
      ).body.error,
    ).toBe('SELF_APPROVAL_FORBIDDEN');
    const ok = await post(
      planner,
      `/budget/requests/${r.body.id}/review`,
      { version: r.body.version, decision: 'APPROVED' },
      key(),
    );
    expect(ok.body.status).toBe('APPROVED');
    // The CD-A1 co-district reviewer cannot see a CD-A2 request.
    expect(
      (await get(codistrict, '/budget/requests')).body.map((x: { id: string }) => x.id),
    ).not.toContain(r.body.id);
  });
});
