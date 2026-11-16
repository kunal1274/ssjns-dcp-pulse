/**
 * Resets the database to the synthetic demonstration state: drops all data, re-applies every
 * migration and reloads the seed. Refuses to run unless every guard below passes, so it can
 * only ever touch a database that contains synthetic demo/test tenants.
 *
 *   DEMO_RESET_CONFIRM=RESET-SYNTHETIC-DEMO pnpm db:demo-reset
 */
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { TENANT_CODE } from '../prisma/seed/data';

const CONFIRM = 'RESET-SYNTHETIC-DEMO';
/** The demo tenant plus the throwaway tenants created by the automated test suites. */
const SYNTHETIC_TENANT = new RegExp(`^(${TENANT_CODE}|OTHER-RBAC|TEST-ISOLATION-[a-f0-9]{8})$`);

async function main(): Promise<void> {
  if (process.env.DEMO_RESET_CONFIRM !== CONFIRM)
    throw new Error(`Refusing to reset: set DEMO_RESET_CONFIRM=${CONFIRM}`);
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to reset when NODE_ENV=production');
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const exists = await db.query(`SELECT to_regclass('public.tenants') AS t`);
    if (exists.rows[0].t) {
      const { rows } = await db.query<{ code: string }>('SELECT code FROM tenants ORDER BY code');
      const foreign = rows.map((r) => r.code).filter((c) => !SYNTHETIC_TENANT.test(c));
      if (foreign.length)
        throw new Error(
          `Refusing to reset: non-synthetic tenant(s) present: ${foreign.join(', ')}`,
        );
      console.info(
        `Guards passed; tenants to discard: ${rows.map((r) => r.code).join(', ') || 'none'}`,
      );
    }
  } finally {
    await db.end();
  }
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { stdio: 'inherit', env: process.env });
  run('pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate']);
  run('pnpm', ['exec', 'tsx', 'prisma/seed/seed.ts']);
  console.info('Synthetic demo data reset complete.');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
