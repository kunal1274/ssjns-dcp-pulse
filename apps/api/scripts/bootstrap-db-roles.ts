/**
 * Idempotent database bootstrap, run before `prisma migrate deploy`:
 *  1. creates the application database (from template0, so it contains only the
 *     extensions our migrations declare), and
 *  2. creates/updates the non-owner application role `dcp_app`, which is subject
 *     to row-level security. Migrations grant it table privileges.
 *
 * Connects with MIGRATION_DATABASE_URL (database owner / admin).
 */
import { Client, escapeIdentifier, escapeLiteral } from 'pg';

export const APP_ROLE = 'dcp_app';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const ownerUrl = new URL(required('MIGRATION_DATABASE_URL'));
  const appPassword = required('APP_DB_PASSWORD');
  if (appPassword.length < 12) throw new Error('APP_DB_PASSWORD must be at least 12 characters');

  const dbName = decodeURIComponent(ownerUrl.pathname.replace(/^\//, ''));
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Unsupported database name: ${dbName}`);

  const maintenanceUrl = new URL(ownerUrl.toString());
  maintenanceUrl.pathname = '/postgres';
  maintenanceUrl.search = '';

  const admin = new Client({ connectionString: maintenanceUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await admin.query(
        `CREATE DATABASE ${escapeIdentifier(dbName)} TEMPLATE template0 ENCODING 'UTF8'`,
      );
      console.info(`Created database ${dbName}`);
    } else {
      console.info(`Database ${dbName} already exists`);
    }

    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
    const verb = role.rowCount === 0 ? 'CREATE' : 'ALTER';
    await admin.query(
      `${verb} ROLE ${escapeIdentifier(APP_ROLE)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${escapeLiteral(appPassword)}`,
    );
    console.info(`${verb === 'CREATE' ? 'Created' : 'Updated'} role ${APP_ROLE}`);
  } finally {
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
