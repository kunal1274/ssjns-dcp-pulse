import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { sha256 } from '../auth/tokens';
import { badRequest, conflict } from './http';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;

/**
 * Runs `fn` once per (user, Idempotency-Key). The key row is inserted in the
 * same transaction as the write: a concurrent duplicate waits on the unique
 * index and then replays the stored response; a failed write rolls back the
 * key so the client may retry.
 */
export async function idempotent<T>(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  key: string | undefined,
  route: string,
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key)
    throw badRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header is required for this request.',
    );
  if (!KEY_PATTERN.test(key))
    throw badRequest(
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key must be 8–100 URL-safe characters.',
    );
  const hash = sha256(`${route}\n${JSON.stringify(body ?? null)}`);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO idempotency_keys (tenant_id, user_id, key, route, request_hash)
    VALUES (${auth.tenantId}::uuid, ${auth.userId}::uuid, ${key}, ${route}, ${hash})
    ON CONFLICT (tenant_id, user_id, key) DO NOTHING RETURNING id`;
  if (inserted.length === 0) {
    const prev = await tx.idempotencyKey.findUniqueOrThrow({
      where: { tenantId_userId_key: { tenantId: auth.tenantId, userId: auth.userId, key } },
    });
    if (prev.requestHash !== hash)
      throw conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request.',
      );
    return prev.responseBody as T;
  }
  const result = await fn();
  await tx.idempotencyKey.update({
    where: { id: inserted[0].id },
    data: {
      responseStatus: 200,
      responseBody: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    },
  });
  return result;
}
