import type { Client } from 'pg';
import { ownerClient } from './db';

const EXPECTED_TABLES = [
  'agencies',
  'agency_jurisdictions',
  'alert_rules',
  'alerts',
  'approval_decisions',
  'audit_events',
  'budget_allocations',
  'budget_requests',
  'budget_versions',
  'commitments',
  'corrective_actions',
  'evidence_files',
  'expenditure_records',
  'external_record_mappings',
  'user_sessions',
  'password_reset_tokens',
  'authentication_events',
  'financial_years',
  'fund_releases',
  'import_batches',
  'jurisdiction_types',
  'jurisdictions',
  'permissions',
  'progress_measurements',
  'progress_submissions',
  'reporting_periods',
  'role_permissions',
  'roles',
  'scheme_locations',
  'scheme_milestones',
  'schemes',
  'tenants',
  'user_credentials',
  'user_role_scopes',
  'users',
  'workflow_definitions',
  'workflow_instances',
];
const GLOBAL_TABLES = ['tenants', 'permissions'];

describe('migrations', () => {
  let db: Client;
  beforeAll(async () => (db = await ownerClient()));
  afterAll(async () => db.end());

  it('applied every migration successfully', async () => {
    const { rows } = await db.query(
      `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.finished_at).not.toBeNull();
      expect(row.rolled_back_at).toBeNull();
    }
  });

  it('installs PostGIS', async () => {
    const { rows } = await db.query(`SELECT extname FROM pg_extension WHERE extname = 'postgis'`);
    expect(rows).toHaveLength(1);
  });

  it('creates all logical-model tables', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('_prisma_migrations', 'spatial_ref_sys')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('puts a NOT NULL uuid tenant_id on every tenant-owned table', async () => {
    const { rows } = await db.query(
      `SELECT table_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const byTable = new Map(rows.map((r) => [r.table_name, r]));
    for (const table of EXPECTED_TABLES.filter((t) => !GLOBAL_TABLES.includes(t))) {
      expect({ table, ...byTable.get(table) }).toMatchObject({
        table,
        data_type: 'uuid',
        is_nullable: 'NO',
      });
    }
  });

  it('enables row-level security with a tenant policy on every tenant-owned table', async () => {
    const { rows } = await db.query(
      `SELECT c.relname, c.relrowsecurity,
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS has_policy
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const byTable = new Map(rows.map((r) => [r.relname, r]));
    for (const table of EXPECTED_TABLES.filter((t) => !GLOBAL_TABLES.includes(t))) {
      expect({ table, ...byTable.get(table) }).toMatchObject({
        table,
        relrowsecurity: true,
        has_policy: true,
      });
    }
    expect(byTable.get('tenants')?.relrowsecurity).toBe(true);
  });

  it('stores every money amount as numeric(18,2) with an explicit currency code', async () => {
    const moneyColumns: [string, string][] = [
      ['budget_versions', 'total_amount'],
      ['budget_requests', 'amount'],
      ['budget_allocations', 'amount'],
      ['fund_releases', 'amount'],
      ['commitments', 'amount'],
      ['expenditure_records', 'amount'],
    ];
    for (const [table, column] of moneyColumns) {
      const { rows } = await db.query(
        `SELECT c.data_type, c.numeric_precision, c.numeric_scale,
                (SELECT data_type FROM information_schema.columns
                  WHERE table_name = $1 AND column_name = 'currency_code') AS currency_type
           FROM information_schema.columns c WHERE c.table_name = $1 AND c.column_name = $2`,
        [table, column],
      );
      expect({ table, ...rows[0] }).toEqual({
        table,
        data_type: 'numeric',
        numeric_precision: 18,
        numeric_scale: 2,
        currency_type: 'character',
      });
    }
  });

  it('uses PostGIS geography/geometry types for spatial columns', async () => {
    const { rows } = await db.query(
      `SELECT table_name, udt_name FROM information_schema.columns
        WHERE column_name = 'geometry' AND table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows).toEqual([
      { table_name: 'jurisdictions', udt_name: 'geometry' },
      { table_name: 'scheme_locations', udt_name: 'geography' },
    ]);
  });

  it('enforces the key unique constraints from the data model', async () => {
    const { rows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE%'`,
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'tenants_code_key',
        'jurisdictions_tenant_id_code_key',
        'users_tenant_id_email_key',
        'schemes_tenant_id_scheme_code_key',
        'permissions_code_key',
        'alerts_tenant_id_dedup_key_key',
        'external_record_mappings_tenant_id_source_system_entity_typ_key',
        'budget_versions_one_approved_per_scheme',
      ]),
    );
  });

  it('runs the API as a non-superuser role that cannot bypass RLS', async () => {
    const { rows } = await db.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'dcp_app'`,
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});
