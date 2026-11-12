import { Client } from 'pg';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
}

/** Connection as the database owner (bypasses RLS; used for setup and invariants). */
export async function ownerClient(): Promise<Client> {
  const client = new Client({ connectionString: requireEnv('MIGRATION_DATABASE_URL') });
  await client.connect();
  return client;
}

/** Connection as the runtime application role (subject to RLS). */
export async function appClient(): Promise<Client> {
  const client = new Client({ connectionString: requireEnv('DATABASE_URL') });
  await client.connect();
  return client;
}

/** Expects `fn` to reject with a PostgreSQL error matching `pattern`. */
export async function expectPgError(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeDefined();
  expect(String((error as Error).message)).toMatch(pattern);
}
