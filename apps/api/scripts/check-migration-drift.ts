/**
 * Fails if prisma/schema.prisma and prisma/migrations disagree.
 * Replays all migrations into a temporary shadow database (created from
 * template0) and diffs the result against the Prisma schema.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Client, escapeIdentifier } from 'pg';

async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error('MIGRATION_DATABASE_URL is required');

  const shadowName = `dcp_shadow_${randomBytes(4).toString('hex')}`;
  const maintenance = new URL(ownerUrl);
  maintenance.pathname = '/postgres';
  maintenance.search = '';
  const shadow = new URL(ownerUrl);
  shadow.pathname = `/${shadowName}`;

  const admin = new Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${escapeIdentifier(shadowName)} TEMPLATE template0`);
  try {
    execFileSync(
      'prisma',
      [
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--shadow-database-url',
        shadow.toString(),
        '--exit-code',
      ],
      { stdio: 'inherit' },
    );
    console.info('Migration drift check passed: migrations match schema.prisma');
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(shadowName)} WITH (FORCE)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
