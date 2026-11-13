const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const SESSION_EXPIRED_EVENT = 'dcp:session-expired';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** The CSRF token is deliberately readable (double-submit); the session cookie is HttpOnly. */
function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)dcp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sensitive financial writes need an Idempotency-Key; pass one to reuse across retries. */
  idempotencyKey?: string;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string | string[];
  } | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(
      res.status,
      data?.error ?? `HTTP_${res.status}`,
      msg ?? res.statusText,
      data,
    );
  }
  return data as T;
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e);

export const inr = (v: string | null | undefined) =>
  v == null
    ? '—'
    : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
