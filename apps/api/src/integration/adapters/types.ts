/** A row-level problem found while reading or validating an import file. */
export interface ImportRowError {
  rowNumber: number;
  field?: string;
  code: string;
  message: string;
  raw?: Record<string, string>;
}

export interface ParsedRow<T> {
  rowNumber: number;
  value: T;
  raw: Record<string, string>;
}

/**
 * Converts an external file format into canonical records. Adapters only check format and
 * schema; business rules (scope, scheme status, duplicates, posting) stay in the core services.
 */
export interface ImportAdapter<T> {
  readonly code: string;
  readonly entityType: string;
  parse(content: string, config: unknown): { rows: ParsedRow<T>[]; errors: ImportRowError[] };
}

/** Canonical fund release as understood by DCP Pulse, independent of any source format. */
export interface CanonicalRelease {
  externalId: string;
  schemeCode: string;
  amount: string;
  releaseDate: string;
  reference: string;
}
