import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { AlertEngineService } from '../../src/alerts/alert-engine.service';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

describe('F11 alerts, corrective actions and GIS (e2e, real database)', () => {
  let app: INestApplication;
  let owner: Client;
  let planner: Session, district: Session, officer: Session, monitor: Session;
  let tenantId: string;
  const ids: Record<string, string> = {};
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const post = (s: Session, url: string, body: object = {}) =>
    s.agent.post(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const patch = (s: Session, url: string, body: object) =>
    s.agent.patch(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const alertByKey = async (key: string) =>
    (await owner.query(`SELECT * FROM alerts WHERE dedup_key = $1`, [key])).rows[0];
  const pfgRule = async () =>
    (
      await owner.query(
        `SELECT id, version FROM alert_rules WHERE rule_code = 'PHYSICAL_FINANCIAL_GAP' AND scope_type = 'TENANT'`,
      )
    ).rows[0] as { id: string; version: number };

  beforeAll(async () => {
    ({ app } = await createApp());
    owner = await ownerClient();
    tenantId = (await owner.query(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).rows[0].id;
    for (const code of ['DEMO-001', 'DEMO-005'])
      ids[code] = (
        await owner.query(`SELECT id FROM schemes WHERE scheme_code = $1`, [code])
      ).rows[0].id;
    ids.officer = (
      await owner.query(`SELECT id FROM users WHERE email = 'field.officer@example.test'`)
    ).rows[0].id;
    planner = await login(app, 'state.planner@example.test');
    district = await login(app, 'district.reviewer@example.test');
    officer = await login(app, 'field.officer@example.test');
    monitor = await login(app, 'state.monitor@example.test');
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('evaluation is idempotent and keeps the seeded DEMO-001 gap alert (dedup by key)', async () => {
    const seeded = await alertByKey('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    const first = await post(planner, '/alert-rules/evaluate').expect(201);
    expect(first.body.rulesEvaluated).toHaveLength(8);
    const again = await post(planner, '/alert-rules/evaluate').expect(201);
    expect(again.body.created).toBe(0);
    expect(again.body.reopened).toBe(0);
    const after = await alertByKey('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    expect(after.id).toBe(seeded.id);
    expect(after.status).toBe('OPEN');
    expect(after.context_json.gapPercentagePoints).toBe('15.00');
    expect(after.review_indicator).toBe(true);
    const dupes = await owner.query(
      `SELECT dedup_key, COUNT(*)::int n FROM alerts GROUP BY dedup_key HAVING COUNT(*) > 1`,
    );
    expect(dupes.rows).toEqual([]);
    // Release > expenditure control is a breach, not a review indicator.
    expect((await alertByKey('RELEASE_EXCEEDED:DEMO-005')).review_indicator).toBe(false);
  });

  it('concurrent evaluations never duplicate alerts', async () => {
    const engine = app.get(AlertEngineService);
    const runs = await Promise.all([
      engine.evaluate(tenantId, { trigger: 'MANUAL' }),
      engine.evaluate(tenantId, { trigger: 'MANUAL' }),
    ]);
    expect(runs.map((r) => r.created)).toEqual([0, 0]);
    const dupes = await owner.query(
      `SELECT dedup_key FROM alerts GROUP BY tenant_id, dedup_key HAVING COUNT(*) > 1`,
    );
    expect(dupes.rows).toEqual([]);
  });

  it('threshold change auto-resolves; restoring it reopens the same alert with history', async () => {
    let rule = await pfgRule();
    await patch(planner, `/alert-rules/${rule.id}`, {
      version: rule.version,
      threshold: { gapPercentagePoints: 16 },
      reason: 'e2e: raise threshold',
    }).expect(200);
    const r1 = await post(planner, '/alert-rules/evaluate').expect(201);
    expect(r1.body.autoResolved).toBeGreaterThanOrEqual(1);
    const resolved = await alertByKey('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolved_by).toBeNull();

    rule = await pfgRule();
    await patch(planner, `/alert-rules/${rule.id}`, {
      version: rule.version,
      threshold: { gapPercentagePoints: 15 },
      reason: 'e2e: restore threshold',
    }).expect(200);
    await post(planner, '/alert-rules/evaluate').expect(201);
    const reopened = await alertByKey('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    expect(reopened.id).toBe(resolved.id);
    expect(reopened.status).toBe('OPEN');
    const events = (
      await owner.query(
        `SELECT event_type FROM alert_events WHERE alert_id = $1 ORDER BY created_at`,
        [reopened.id],
      )
    ).rows.map((r) => r.event_type);
    expect(events).toEqual(expect.arrayContaining(['AUTO_RESOLVED', 'REOPENED']));
    const audits = await owner.query(
      `SELECT COUNT(*)::int n FROM audit_events WHERE entity_type = 'alert_rule' AND action = 'alert_rule.updated' AND entity_id = $1`,
      [rule.id],
    );
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('rule writes are validated, permission-checked and stale versions are refused', async () => {
    const rule = await pfgRule();
    await patch(planner, `/alert-rules/${rule.id}`, {
      version: rule.version,
      threshold: { gapPercentagePoints: 0 },
      reason: 'invalid',
    }).expect(400);
    await patch(planner, `/alert-rules/${rule.id}`, {
      version: rule.version - 1,
      enabled: true,
      reason: 'stale',
    }).expect(409);
    await patch(officer, `/alert-rules/${rule.id}`, {
      version: rule.version,
      enabled: false,
      reason: 'no',
    }).expect(403);
    await post(officer, '/alert-rules/evaluate').expect(403);
    await post(district, '/alert-rules', {
      ruleCode: 'DATA_STALE',
      scopeType: 'TENANT',
      effectiveFrom: '2027-01-01',
      threshold: { maxDaysSinceVerifiedUpdate: 30 },
      severity: 'LOW',
      ownerRoleCode: 'DISTRICT_REVIEWER',
    }).expect(403);
    const day = String(1 + (Date.now() % 27)).padStart(2, '0');
    const created = await post(planner, '/alert-rules', {
      ruleCode: 'PHYSICAL_FINANCIAL_GAP',
      scopeType: 'SCHEME',
      scopeId: ids['DEMO-001'],
      effectiveFrom: `2030-${String(1 + (Date.now() % 12)).padStart(2, '0')}-${day}`,
      threshold: { gapPercentagePoints: 20 },
      severity: 'HIGH',
      ownerRoleCode: 'DISTRICT_REVIEWER',
      enabled: false,
      evaluationFrequency: 'WEEKLY',
      description: 'e2e future-dated scheme override',
    });
    expect([201, 409]).toContain(created.status);
    const list = await get(planner, '/alert-rules').expect(200);
    expect(list.body.canManage).toBe(true);
    expect(list.body.items.length).toBeGreaterThanOrEqual(8);
  });

  it('district scope: District A reviewer cannot see a District B alert; monitor is read-only', async () => {
    const b = await alertByKey('RELEASE_EXCEEDED:DEMO-005');
    await get(district, `/alerts/${b.id}`).expect(404);
    const list = await get(district, '/alerts?pageSize=100').expect(200);
    expect(list.body.items.find((a: { id: string }) => a.id === b.id)).toBeUndefined();
    await get(monitor, `/alerts/${b.id}`).expect(200);
    await post(monitor, `/alerts/${b.id}/acknowledge`, { version: b.version }).expect(403);
  });

  it('lifecycle: acknowledge, assign, corrective action, independent verification, resolve', async () => {
    const a = await alertByKey('PHYSICAL_FINANCIAL_GAP:DEMO-001');
    const ack = await post(district, `/alerts/${a.id}/acknowledge`, {
      version: a.version,
      note: 'Looking into it',
    }).expect(201);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    await post(district, `/alerts/${a.id}/acknowledge`, { version: ack.body.version }).expect(409);
    const asg = await post(district, `/alerts/${a.id}/assign`, {
      version: ack.body.version,
      assigneeId: ids.officer,
    }).expect(201);
    expect(asg.body.assigneeId).toBe(ids.officer);

    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const ca = await post(district, '/corrective-actions', {
      alertId: a.id,
      ownerId: ids.officer,
      actionText: 'Reconcile measurement book with verified expenditure',
      dueAt: due,
      priority: 'HIGH',
    }).expect(201);
    expect(ca.body.status).toBe('ASSIGNED');
    expect((await alertByKey(a.dedup_key)).status).toBe('IN_PROGRESS');

    const cur = await get(planner, `/alerts/${a.id}`);
    expect(cur.status).toBe(403); // planner manages rules but has no alert.view
    const alertNow = (await get(district, `/alerts/${a.id}`).expect(200)).body;
    await post(district, `/alerts/${a.id}/resolve`, {
      version: alertNow.version,
      reason: 'Trying too early',
    }).expect(409);

    const p1 = await patch(officer, `/corrective-actions/${ca.body.id}`, {
      version: ca.body.version,
      progressNote: 'Site visit scheduled',
    }).expect(200);
    expect(p1.body.status).toBe('IN_PROGRESS');
    const sub = await post(officer, `/corrective-actions/${ca.body.id}/submit-for-verification`, {
      version: p1.body.version,
      evidenceNote: 'Synthetic MB page reference 12',
    }).expect(201);
    expect(sub.body.status).toBe('PENDING_VERIFICATION');
    await post(officer, `/corrective-actions/${ca.body.id}/close`, {
      version: sub.body.version,
      decision: 'CLOSE',
      reason: 'self',
    }).expect(403);
    const mine = await get(officer, '/corrective-actions?mine=true').expect(200);
    expect(mine.body.items.some((c: { id: string }) => c.id === ca.body.id)).toBe(true);

    const re = await post(district, `/corrective-actions/${ca.body.id}/close`, {
      version: sub.body.version,
      decision: 'REOPEN',
      reason: 'Evidence does not cover milestone 2',
    }).expect(201);
    expect(re.body.status).toBe('REOPENED');
    const sub2 = await post(officer, `/corrective-actions/${ca.body.id}/submit-for-verification`, {
      version: re.body.version,
      evidenceNote: 'Synthetic MB pages 12-14',
    }).expect(201);
    const closed = await post(district, `/corrective-actions/${ca.body.id}/close`, {
      version: sub2.body.version,
      decision: 'CLOSE',
      reason: 'Verified against synthetic MB',
    }).expect(201);
    expect(closed.body.status).toBe('CLOSED');

    const detail = (await get(district, `/corrective-actions/${ca.body.id}`).expect(200)).body;
    expect(detail.events.map((e: { eventType: string }) => e.eventType)).toEqual([
      'CREATED',
      'PROGRESS_NOTE',
      'SUBMITTED_FOR_VERIFICATION',
      'REOPENED',
      'SUBMITTED_FOR_VERIFICATION',
      'CLOSED',
    ]);
    const v = (await get(district, `/alerts/${a.id}`).expect(200)).body;
    const res = await post(district, `/alerts/${a.id}/resolve`, {
      version: v.version,
      reason: 'Corrective action verified',
    }).expect(201);
    expect(res.body.status).toBe('RESOLVED');
    // Manually resolved while the condition persists: evaluation must not reopen it.
    await post(planner, '/alert-rules/evaluate').expect(201);
    expect((await alertByKey(a.dedup_key)).status).toBe('RESOLVED');
    const reo = await post(district, `/alerts/${a.id}/reopen`, {
      version: res.body.version,
      reason: 'e2e: reopen for later demos',
    }).expect(201);
    expect(reo.body.status).toBe('OPEN');
  });

  it('database refuses a corrective action verified by its own owner, and event history is append-only', async () => {
    const ca = (await owner.query(`SELECT id, owner_id FROM corrective_actions LIMIT 1`)).rows[0];
    await expect(
      owner.query(`UPDATE corrective_actions SET verified_by = owner_id WHERE id = $1`, [ca.id]),
    ).rejects.toThrow(/corrective_actions_independent_verifier/);
    const grants = await owner.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dcp_app' AND table_name = 'alert_events' ORDER BY privilege_type`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('unacknowledged alerts past their response window escalate once per evaluation', async () => {
    const b = await alertByKey('RELEASE_EXCEEDED:DEMO-005');
    await owner.query(
      `UPDATE alerts SET status = 'OPEN', due_at = now() - interval '1 day', escalation_level = 0 WHERE id = $1`,
      [b.id],
    );
    const r = await post(planner, '/alert-rules/evaluate').expect(201);
    expect(r.body.escalated).toBeGreaterThanOrEqual(1);
    const after = await alertByKey(b.dedup_key);
    expect(after.escalation_level).toBe(1);
    expect(new Date(after.due_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('GIS returns only in-scope synthetic WGS84 points with KPI and alert properties', async () => {
    const all = (await get(monitor, '/gis/schemes').expect(200)).body;
    expect(all.notice).toMatch(/synthetic/i);
    expect(all.crs).toContain('4326');
    const demo1 = all.features.find(
      (f: { properties: { schemeCode: string } }) => f.properties.schemeCode === 'DEMO-001',
    );
    expect(demo1.properties.synthetic).toBe(true);
    expect(demo1.properties.locationAccuracy).toBe('SYNTHETIC_APPROXIMATE');
    expect(demo1.properties.financialUtilisationPercent).toBe('55.00');
    expect(demo1.properties.physicalCompletionPercent).toBe('40.00');
    const [lon, lat] = demo1.geometry.coordinates;
    expect(lon).toBeGreaterThan(89.6);
    expect(lat).toBeLessThan(28);

    const mine = (await get(district, '/gis/schemes').expect(200)).body;
    const codes = mine.features.map(
      (f: { properties: { schemeCode: string } }) => f.properties.schemeCode,
    );
    expect(codes).toContain('DEMO-001');
    expect(codes).not.toContain('DEMO-005');
    await get(district, `/gis/schemes/${ids['DEMO-005']}`).expect(404);
    const d = (await get(district, `/gis/schemes/${ids['DEMO-001']}`).expect(200)).body;
    expect(d.notice).toMatch(/Synthetic/);

    const filtered = (await get(monitor, '/gis/schemes?category=WATER').expect(200)).body;
    expect(
      filtered.features.every(
        (f: { properties: { category: string } }) => f.properties.category === 'WATER',
      ),
    ).toBe(true);
  });
});
