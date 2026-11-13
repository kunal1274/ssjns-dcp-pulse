import type { Client } from 'pg';
import { PrismaService } from '../../src/prisma/prisma.service';
import { appClient, expectPgError, ownerClient } from './db';

/**
 * Tenant isolation is enforced by PostgreSQL RLS for the runtime role
 * (`dcp_app`), using the transaction-local `app.tenant_id` setting (§3, §13).
 */
describe('tenant isolation (RLS)', () => {
  let owner: Client;
  let app: Client;
  let tenantA: string;
  let tenantB: string;

  const withTenant = async <T>(
    client: Client,
    tenantId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> => {
    await client.query('BEGIN');
    try {
      if (tenantId) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn();
    } finally {
      await client.query('ROLLBACK');
    }
  };
  const countAs = async (tenantId: string | null, table: string) =>
    withTenant(app, tenantId, async () =>
      Number((await app.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n),
    );

  beforeAll(async () => {
    owner = await ownerClient();
    app = await appClient();
    tenantA = (await owner.query(`SELECT id FROM tenants WHERE code = 'ASSAM-DEMO'`)).rows[0].id;
    tenantB = (
      await owner.query(
        `INSERT INTO tenants (code, name) VALUES ('TEST-ISOLATION-' || substr(md5(random()::text), 1, 8), 'Isolation test tenant') RETURNING id`,
      )
    ).rows[0].id;
    await owner.query(
      `INSERT INTO jurisdiction_types (tenant_id, code, display_name, sort_order) VALUES ($1, 'STATE', 'State', 1)`,
      [tenantB],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM jurisdiction_types WHERE tenant_id = $1`, [tenantB]);
    await owner.query(`DELETE FROM tenants WHERE id = $1`, [tenantB]);
    await owner.end();
    await app.end();
  });

  it('denies all rows when no tenant context is set', async () => {
    expect(await countAs(null, 'schemes')).toBe(0);
    expect(await countAs(null, 'jurisdictions')).toBe(0);
    expect(await countAs(null, 'tenants')).toBe(0);
  });

  it('returns only the current tenant rows', async () => {
    // Seeded 12 plus any created by e2e runs; tenant B must still see none.
    expect(await countAs(tenantA, 'schemes')).toBeGreaterThanOrEqual(12);
    expect(await countAs(tenantB, 'schemes')).toBe(0);
    expect(await countAs(tenantA, 'jurisdiction_types')).toBe(3);
    expect(await countAs(tenantB, 'jurisdiction_types')).toBe(1);
    expect(await countAs(tenantB, 'tenants')).toBe(1);
  });

  it('rejects writes into another tenant', async () => {
    await withTenant(app, tenantB, () =>
      expectPgError(
        () =>
          app.query(
            `INSERT INTO jurisdiction_types (tenant_id, code, display_name, sort_order) VALUES ($1, 'X', 'X', 9)`,
            [tenantA],
          ),
        /row-level security/,
      ),
    );
  });

  it('cannot update or delete another tenant rows (they are invisible)', async () => {
    await withTenant(app, tenantB, async () => {
      const upd = await app.query(`UPDATE schemes SET name = 'hijacked' WHERE tenant_id = $1`, [
        tenantA,
      ]);
      const del = await app.query(`DELETE FROM alerts WHERE tenant_id = $1`, [tenantA]);
      expect(upd.rowCount).toBe(0);
      expect(del.rowCount).toBe(0);
    });
  });

  it('does not leak tenant context beyond the transaction', async () => {
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
    await app.query('COMMIT');
    expect(Number((await app.query(`SELECT count(*) AS n FROM schemes`)).rows[0].n)).toBe(0);
  });

  it('blocks cross-tenant references through composite foreign keys', async () => {
    const agencyA = (
      await owner.query(`SELECT id FROM agencies WHERE tenant_id = $1 LIMIT 1`, [tenantA])
    ).rows[0].id;
    const typeB = (
      await owner.query(`SELECT id FROM jurisdiction_types WHERE tenant_id = $1`, [tenantB])
    ).rows[0].id;
    await owner.query('BEGIN');
    try {
      const jurisdictionB = (
        await owner.query(
          `INSERT INTO jurisdictions (tenant_id, type_id, code, name) VALUES ($1, $2, 'B-STATE', 'B') RETURNING id`,
          [tenantB, typeB],
        )
      ).rows[0].id;
      await expectPgError(
        () =>
          owner.query(
            `INSERT INTO agency_jurisdictions (tenant_id, agency_id, jurisdiction_id, relationship_type, effective_from)
             VALUES ($1, $2, $3, 'IMPLEMENTS_IN', CURRENT_DATE)`,
            [tenantB, agencyA, jurisdictionB],
          ),
        /foreign key/,
      );
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('denies the runtime role writes to global and audit tables', async () => {
    await withTenant(app, tenantA, () =>
      expectPgError(() => app.query(`UPDATE tenants SET name = 'x'`), /permission denied/),
    );
    await withTenant(app, tenantA, () =>
      expectPgError(() => app.query(`DELETE FROM audit_events`), /permission denied/),
    );
    await withTenant(app, tenantA, async () => {
      await app.query(
        `INSERT INTO audit_events (tenant_id, action, entity_type, reason) VALUES ($1, 'TEST', 'test', 'rls test')`,
        [tenantA],
      );
    });
  });

  it('PrismaService.withTenant scopes queries to the given tenant', async () => {
    const prisma = new PrismaService();
    try {
      await expect(
        prisma.withTenant(tenantA, (tx) => tx.scheme.count()),
      ).resolves.toBeGreaterThanOrEqual(12);
      await expect(prisma.withTenant(tenantB, (tx) => tx.scheme.count())).resolves.toBe(0);
      await expect(prisma.scheme.count()).resolves.toBe(0);
      await expect(prisma.withTenant('not-a-uuid', (tx) => tx.scheme.count())).rejects.toThrow(
        /UUID/,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
