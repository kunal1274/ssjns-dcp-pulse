/**
 * PostgreSQL setting that carries the current tenant for row-level security.
 * It must only ever be set transaction-locally (`set_config(..., true)`), so a
 * pooled connection never carries tenant context into another request.
 */
export const TENANT_CONTEXT_SETTING = 'app.tenant_id';

export const SCOPE_TYPES = ['TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const SYNTHETIC_DATA_DISCLAIMER =
  'Synthetic demonstration data. Not a government deployment and not an official administrative structure.';
