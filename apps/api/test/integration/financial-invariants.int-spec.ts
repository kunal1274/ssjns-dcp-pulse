import type { Client } from 'pg';
import { expectPgError, ownerClient } from './db';

/**
 * Database-level financial integrity (§5, §8, §13). Each test runs in a
 * transaction that is rolled back, except the concurrency test, which needs
 * committed fixtures and cleans them up afterwards.
 */
describe('financial invariants', () => {
  let db: Client;
  let tenantId: string;
  let demo001: string;

  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
  const inRollback = async (fn: () => Promise<void>) => {
    await db.query('BEGIN');
    try {
      await fn();
    } finally {
      await db.query('ROLLBACK');
    }
  };

  beforeAll(async () => {
    db = await ownerClient();
    tenantId = (await one(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).id;
    demo001 = (
      await one(`SELECT id FROM schemes WHERE tenant_id = $1 AND scheme_code = 'DEMO-001'`, [
        tenantId,
      ])
    ).id;
  });
  afterAll(async () => db.end());

  it('rejects an approved child allocation that exceeds its parent ceiling', async () => {
    await inRollback(async () => {
      const parent = await one(
        `SELECT a.id, a.budget_version_id, a.recipient_jurisdiction_id FROM budget_allocations a
          WHERE a.scheme_id = $1 AND a.parent_allocation_id IS NULL`,
        [demo001],
      );
      await expectPgError(
        () =>
          db.query(
            `INSERT INTO budget_allocations (tenant_id, budget_version_id, parent_allocation_id, recipient_jurisdiction_id, scheme_id, amount, status)
             VALUES ($1, $2, $3, $4, $5, 0.01, 'APPROVED')`,
            [
              tenantId,
              parent.budget_version_id,
              parent.id,
              parent.recipient_jurisdiction_id,
              demo001,
            ],
          ),
        /ALLOCATION_CEILING_EXCEEDED/,
      );
    });
  });

  it('rejects a top-level allocation beyond the approved budget version total', async () => {
    await inRollback(async () => {
      const top = await one(
        `SELECT * FROM budget_allocations WHERE scheme_id = $1 AND parent_allocation_id IS NULL`,
        [demo001],
      );
      await expectPgError(
        () => db.query(`UPDATE budget_allocations SET amount = amount + 1 WHERE id = $1`, [top.id]),
        /ALLOCATION_CEILING_EXCEEDED/,
      );
    });
  });

  it('rejects reducing a parent allocation below its approved children', async () => {
    await inRollback(async () => {
      const top = await one(
        `SELECT id FROM budget_allocations WHERE scheme_id = $1 AND parent_allocation_id IS NULL`,
        [demo001],
      );
      await expectPgError(
        () => db.query(`UPDATE budget_allocations SET amount = 1 WHERE id = $1`, [top.id]),
        /ALLOCATION_BELOW_CHILD_TOTAL/,
      );
    });
  });

  it('rejects reducing an approved budget version below what is allocated', async () => {
    await inRollback(async () => {
      await expectPgError(
        () =>
          db.query(
            `UPDATE budget_versions SET total_amount = 1 WHERE scheme_id = $1 AND status = 'APPROVED'`,
            [demo001],
          ),
        /BUDGET_VERSION_BELOW_ALLOCATED/,
      );
    });
  });

  it('allows only one approved budget version per scheme', async () => {
    await inRollback(async () => {
      const fy = await one(`SELECT financial_year_id FROM schemes WHERE id = $1`, [demo001]);
      await expectPgError(
        () =>
          db.query(
            `INSERT INTO budget_versions (tenant_id, financial_year_id, scheme_id, version_number, status, total_amount, approved_at)
             VALUES ($1, $2, $3, 99, 'APPROVED', 1, now())`,
            [tenantId, fy.financial_year_id, demo001],
          ),
        /budget_versions_one_approved_per_scheme/,
      );
    });
  });

  it('serialises concurrent allocations so the ceiling cannot be exceeded', async () => {
    const fixture = await one(
      `WITH s AS (
         INSERT INTO schemes (tenant_id, scheme_code, name, category, financial_year_id, agency_id, jurisdiction_id, status)
         SELECT tenant_id, 'TEST-CONCURRENCY-' || substr(md5(random()::text), 1, 8), 'Concurrency fixture', category,
                financial_year_id, agency_id, jurisdiction_id, 'APPROVED'
           FROM schemes WHERE id = $1
         RETURNING id, tenant_id, financial_year_id, jurisdiction_id),
       v AS (
         INSERT INTO budget_versions (tenant_id, financial_year_id, scheme_id, version_number, status, total_amount, approved_at)
         SELECT tenant_id, financial_year_id, id, 1, 'APPROVED', 100.00, now() FROM s
         RETURNING id, scheme_id)
       SELECT s.id AS scheme_id, s.jurisdiction_id, v.id AS version_id FROM s JOIN v ON v.scheme_id = s.id`,
      [demo001],
    );
    const insertSql = `INSERT INTO budget_allocations (tenant_id, budget_version_id, recipient_jurisdiction_id, scheme_id, amount, status)
                       VALUES ($1, $2, $3, $4, 60.00, 'APPROVED')`;
    const params = [tenantId, fixture.version_id, fixture.jurisdiction_id, fixture.scheme_id];

    const a = await ownerClient();
    const b = await ownerClient();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      await a.query(insertSql, params);
      // b blocks on the version row lock until a commits, then sees a's 60.00.
      const bResult = b.query(insertSql, params).then(
        () => 'ok',
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 200));
      await a.query('COMMIT');
      const outcome = await bResult;
      await b.query('ROLLBACK');

      expect(outcome).toMatch(/ALLOCATION_CEILING_EXCEEDED/);
      const total = await one(
        `SELECT sum(amount) AS total FROM budget_allocations WHERE budget_version_id = $1`,
        [fixture.version_id],
      );
      expect(total.total).toBe('60.00');
    } finally {
      await a.end();
      await b.end();
      await db.query(`DELETE FROM budget_allocations WHERE budget_version_id = $1`, [
        fixture.version_id,
      ]);
      await db.query(`DELETE FROM budget_versions WHERE id = $1`, [fixture.version_id]);
      await db.query(`DELETE FROM schemes WHERE id = $1`, [fixture.scheme_id]);
    }
  });

  it('rejects negative amounts and non-ISO currency codes', async () => {
    await inRollback(async () => {
      await db.query('SAVEPOINT s');
      await expectPgError(
        () => db.query(`UPDATE commitments SET amount = -1 WHERE tenant_id = $1`, [tenantId]),
        /commitments_amount_non_negative/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(`UPDATE commitments SET currency_code = 'rs1' WHERE tenant_id = $1`, [tenantId]),
        /commitments_currency_code_format/,
      );
    });
  });

  it('makes verified expenditure immutable and accepts a superseding correction with a reason', async () => {
    await inRollback(async () => {
      const verified = await one(
        `SELECT * FROM expenditure_records WHERE scheme_id = $1 AND status = 'VERIFIED' ORDER BY reference LIMIT 1`,
        [demo001],
      );
      await db.query('SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(`UPDATE expenditure_records SET amount = amount + 1 WHERE id = $1`, [
            verified.id,
          ]),
        /VERIFIED_RECORD_IMMUTABLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () => db.query(`DELETE FROM expenditure_records WHERE id = $1`, [verified.id]),
        /VERIFIED_RECORD_IMMUTABLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');

      const insertCorrection = (reason: string | null) =>
        db.query(
          `INSERT INTO expenditure_records (tenant_id, scheme_id, period_id, amount, expenditure_date, reference, status, source, submitted_by, supersedes_id, correction_reason)
           VALUES ($1, $2, $3, 2900000.00, $4, 'SYN-EXP-CORRECTION', 'SUBMITTED', 'MANUAL_DEMO', $5, $6, $7)`,
          [
            tenantId,
            demo001,
            verified.period_id,
            verified.expenditure_date,
            verified.submitted_by,
            verified.id,
            reason,
          ],
        );
      await expectPgError(
        () => insertCorrection('  '),
        /expenditure_records_correction_has_reason/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expect(
        insertCorrection('Synthetic correction: invoice total revised'),
      ).resolves.toBeDefined();
    });
  });

  it('makes verified releases, verified submissions and their measurements immutable', async () => {
    await inRollback(async () => {
      await db.query('SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(
            `UPDATE fund_releases SET amount = 1 WHERE scheme_id = $1 AND verification_status = 'VERIFIED'`,
            [demo001],
          ),
        /VERIFIED_RECORD_IMMUTABLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(
            `UPDATE progress_submissions SET remarks = 'edited' WHERE scheme_id = $1 AND status = 'VERIFIED'`,
            [demo001],
          ),
        /VERIFIED_RECORD_IMMUTABLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(
            `UPDATE progress_measurements SET quantity_completed = 1
              WHERE submission_id IN (SELECT id FROM progress_submissions WHERE scheme_id = $1 AND status = 'VERIFIED')`,
            [demo001],
          ),
        /VERIFIED_RECORD_IMMUTABLE/,
      );
    });
  });

  it('prevents the submitter from verifying their own expenditure (maker-checker)', async () => {
    await inRollback(async () => {
      const reported = await one(
        `SELECT * FROM expenditure_records WHERE tenant_id = $1 AND status = 'SUBMITTED' LIMIT 1`,
        [tenantId],
      );
      await expectPgError(
        () =>
          db.query(
            `UPDATE expenditure_records SET status = 'VERIFIED', verified_by = submitted_by, verified_at = now() WHERE id = $1`,
            [reported.id],
          ),
        /expenditure_records_maker_checker/,
      );
    });
  });

  it('keeps audit events append-only', async () => {
    await inRollback(async () => {
      await db.query('SAVEPOINT s');
      await expectPgError(
        () => db.query(`UPDATE audit_events SET reason = 'x' WHERE tenant_id = $1`, [tenantId]),
        /AUDIT_EVENTS_APPEND_ONLY/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () => db.query(`DELETE FROM audit_events WHERE tenant_id = $1`, [tenantId]),
        /AUDIT_EVENTS_APPEND_ONLY/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(() => db.query(`TRUNCATE audit_events`), /AUDIT_EVENTS_APPEND_ONLY/);
    });
  });

  it('prevents jurisdiction cycles and maintains ancestry on re-parenting', async () => {
    await inRollback(async () => {
      const ids = Object.fromEntries(
        (
          await db.query(`SELECT code, id FROM jurisdictions WHERE tenant_id = $1`, [tenantId])
        ).rows.map((r) => [r.code, r.id]),
      );
      await db.query('SAVEPOINT s');
      await expectPgError(
        () =>
          db.query(`UPDATE jurisdictions SET parent_id = $1 WHERE id = $2`, [
            ids['CD-A1'],
            ids['DIST-A'],
          ]),
        /JURISDICTION_CYCLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expectPgError(
        () => db.query(`UPDATE jurisdictions SET parent_id = id WHERE id = $1`, [ids['DIST-A']]),
        /jurisdictions_not_own_parent|JURISDICTION_CYCLE/,
      );
      await db.query('ROLLBACK TO SAVEPOINT s');

      // Move CD-A1 under DIST-B: its ancestry must follow.
      await db.query(`UPDATE jurisdictions SET parent_id = $1 WHERE id = $2`, [
        ids['DIST-B'],
        ids['CD-A1'],
      ]);
      const moved = await one(
        `SELECT ancestry::text[] AS ancestry FROM jurisdictions WHERE id = $1`,
        [ids['CD-A1']],
      );
      expect(moved.ancestry).toEqual([ids['AS-DEMO'], ids['DIST-B']]);
    });
  });
});
