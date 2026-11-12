import type { Client } from 'pg';
import { ownerClient } from './db';

describe('synthetic ASSAM-DEMO seed', () => {
  let db: Client;
  let tenantId: string;
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
  const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

  beforeAll(async () => {
    db = await ownerClient();
    tenantId = (await one(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).id;
  });
  afterAll(async () => db.end());

  it('marks the tenant as synthetic INR data', async () => {
    const t = await one(`SELECT settings_json FROM tenants WHERE id = $1`, [tenantId]);
    expect(t.settings_json).toMatchObject({ currency: 'INR', synthetic: true });
  });

  it('has Assam -> 2 districts -> 2 co-districts each, with ancestry', async () => {
    const rows = (
      await db.query(
        `SELECT j.code, jt.code AS type, cardinality(j.ancestry) AS depth
           FROM jurisdictions j JOIN jurisdiction_types jt ON jt.id = j.type_id
          WHERE j.tenant_id = $1 ORDER BY j.code`,
        [tenantId],
      )
    ).rows;
    expect(rows.filter((r) => r.type === 'STATE')).toHaveLength(1);
    expect(rows.filter((r) => r.type === 'DISTRICT').map((r) => r.code)).toEqual([
      'DIST-A',
      'DIST-B',
    ]);
    expect(rows.filter((r) => r.type === 'CO_DISTRICT')).toHaveLength(4);
    expect(rows.find((r) => r.code === 'CD-A1')?.depth).toBe(2);
  });

  it('has 3 implementing agencies, 12 schemes across 3 categories, FY 2026-27 and 8 users', async () => {
    expect(
      await count(
        `SELECT count(*) n FROM agencies WHERE tenant_id = $1 AND agency_type = 'IMPLEMENTING'`,
        [tenantId],
      ),
    ).toBe(3);
    expect(
      await count(
        `SELECT count(*) n FROM schemes WHERE tenant_id = $1 AND scheme_code LIKE 'DEMO-%'`,
        [tenantId],
      ),
    ).toBe(12);
    const cats = (
      await db.query(
        `SELECT category, count(*)::int n FROM schemes WHERE tenant_id = $1 AND scheme_code LIKE 'DEMO-%' GROUP BY category ORDER BY category`,
        [tenantId],
      )
    ).rows;
    expect(cats).toEqual([
      { category: 'PUBLIC_FACILITY', n: 4 },
      { category: 'ROAD', n: 4 },
      { category: 'WATER', n: 4 },
    ]);
    expect(
      await count(
        `SELECT count(*) n FROM financial_years WHERE tenant_id = $1 AND code = '2026-27'`,
        [tenantId],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) n FROM users WHERE tenant_id = $1 AND created_by IS NULL`, [
        tenantId,
      ]),
    ).toBe(8);
  });

  it('stores only Argon2id hashes for demo users with example.test emails', async () => {
    const rows = (
      await db.query(
        `SELECT u.email, c.password_hash FROM users u JOIN user_credentials c ON c.user_id = u.id WHERE u.tenant_id = $1 AND u.created_by IS NULL`,
        [tenantId],
      )
    ).rows;
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.email).toMatch(/@example\.test$/);
      expect(r.password_hash).toMatch(/^\$argon2id\$v=19\$/);
    }
  });

  it('has exactly 2 overdue milestones at the seed reference date', async () => {
    expect(
      await count(
        `SELECT count(*) n FROM scheme_milestones WHERE tenant_id = $1 AND target_date < DATE '2026-11-11' AND status <> 'COMPLETED'`,
        [tenantId],
      ),
    ).toBe(2);
  });

  it('has 3 pending, 1 returned and 2 verified progress submissions', async () => {
    const rows = (
      await db.query(
        `SELECT status::text, count(*)::int n FROM progress_submissions WHERE tenant_id = $1 GROUP BY status`,
        [tenantId],
      )
    ).rows;
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    expect((by.SUBMITTED ?? 0) + (by.UNDER_REVIEW ?? 0)).toBe(3);
    expect(by.RETURNED).toBe(1);
    expect(by.VERIFIED).toBe(2);
  });

  it('has 3 alerts with unique dedup keys and illustrative rules', async () => {
    expect(
      await count(`SELECT count(DISTINCT dedup_key) n FROM alerts WHERE tenant_id = $1`, [
        tenantId,
      ]),
    ).toBe(3);
    expect(
      await count(
        `SELECT count(*) n FROM alert_rules WHERE tenant_id = $1 AND NOT is_illustrative`,
        [tenantId],
      ),
    ).toBe(0);
  });

  it('reproduces the DEMO-001 worked example from verified records (§5)', async () => {
    const r = await one(
      `SELECT
         (SELECT total_amount FROM budget_versions WHERE scheme_id = s.id AND status = 'APPROVED') AS budget,
         (SELECT sum(amount) FROM fund_releases WHERE scheme_id = s.id AND verification_status = 'VERIFIED') AS released,
         (SELECT sum(amount) FROM expenditure_records WHERE scheme_id = s.id AND status = 'VERIFIED') AS spent,
         (SELECT sum(m.weight * LEAST(pm.quantity_completed / m.target_quantity, 1))
            FROM progress_measurements pm
            JOIN progress_submissions ps ON ps.id = pm.submission_id AND ps.status = 'VERIFIED'
            JOIN scheme_milestones m ON m.id = pm.milestone_id
           WHERE ps.scheme_id = s.id) AS physical_pct
       FROM schemes s WHERE s.tenant_id = $1 AND s.scheme_code = 'DEMO-001'`,
      [tenantId],
    );
    expect(r.budget).toBe('10000000.00');
    expect(r.released).toBe('7000000.00');
    expect(r.spent).toBe('5500000.00');
    expect(Number(r.physical_pct)).toBe(40);
  });

  it('allocates each scheme once as a leaf (no parent/child double counting)', async () => {
    const r = await one(
      `SELECT
         (SELECT sum(a.amount) FROM budget_allocations a
           WHERE a.tenant_id = $1 AND a.status = 'APPROVED'
             AND a.created_by IS NULL AND NOT EXISTS (SELECT 1 FROM budget_allocations c WHERE c.parent_allocation_id = a.id)) AS leaf_total,
         (SELECT sum(total_amount) FROM budget_versions WHERE tenant_id = $1 AND status = 'APPROVED' AND created_by IS NULL AND scheme_id IS NOT NULL) AS approved_total`,
      [tenantId],
    );
    expect(r.leaf_total).toBe(r.approved_total);
  });

  it('includes deliberate variance cases', async () => {
    const r = await one(
      `SELECT
         (SELECT sum(amount) FROM fund_releases fr WHERE fr.scheme_id = s.id AND verification_status = 'VERIFIED') AS released,
         (SELECT sum(amount) FROM expenditure_records e WHERE e.scheme_id = s.id AND status = 'VERIFIED') AS spent
       FROM schemes s WHERE s.tenant_id = $1 AND s.scheme_code = 'DEMO-005'`,
      [tenantId],
    );
    expect(Number(r.spent)).toBeGreaterThan(Number(r.released));
  });

  it('places synthetic scheme locations as WGS84 points', async () => {
    expect(
      await count(
        `SELECT count(*) n FROM scheme_locations WHERE tenant_id = $1 AND ST_GeometryType(geometry::geometry) = 'ST_Point' AND ST_SRID(geometry::geometry) = 4326`,
        [tenantId],
      ),
    ).toBe(12);
  });
});
