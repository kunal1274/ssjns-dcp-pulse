import { parseCsv } from './csv';
import type { CanonicalRelease, ImportAdapter, ImportRowError, ParsedRow } from './types';

const FIELDS = ['externalId', 'schemeCode', 'amount', 'releaseDate', 'reference'] as const;
type Field = (typeof FIELDS)[number];
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CsvReleaseConfig {
  columns: Record<Field, string>;
  maxRows: number;
}

function config(c: unknown): CsvReleaseConfig {
  const v = c as Partial<CsvReleaseConfig> | null;
  if (!v?.columns || FIELDS.some((f) => typeof v.columns?.[f] !== 'string'))
    throw new Error('Import source configuration is missing a column mapping.');
  return { columns: v.columns, maxRows: v.maxRows ?? 1000 };
}

const validDate = (s: string) => {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Synthetic e-Rupantor-style fund-release CSV. Column names come from the source configuration. */
export const csvFundReleaseAdapter: ImportAdapter<CanonicalRelease> = {
  code: 'CSV_FUND_RELEASE_V1',
  entityType: 'fund_release',
  parse(content, rawConfig) {
    const cfg = config(rawConfig);
    const errors: ImportRowError[] = [];
    let table: string[][];
    try {
      table = parseCsv(content);
    } catch (e) {
      return {
        rows: [],
        errors: [{ rowNumber: 0, code: 'MALFORMED_CSV', message: (e as Error).message }],
      };
    }
    if (table.length === 0)
      return {
        rows: [],
        errors: [{ rowNumber: 0, code: 'EMPTY_FILE', message: 'The file has no header row.' }],
      };
    const header = table[0].map((h) => h.trim().toLowerCase());
    const index = {} as Record<Field, number>;
    for (const f of FIELDS) {
      index[f] = header.indexOf(cfg.columns[f].toLowerCase());
      if (index[f] < 0)
        errors.push({
          rowNumber: 1,
          field: cfg.columns[f],
          code: 'MISSING_COLUMN',
          message: `Required column "${cfg.columns[f]}" is missing.`,
        });
    }
    if (errors.length) return { rows: [], errors };
    const body = table.slice(1);
    if (body.length > cfg.maxRows)
      return {
        rows: [],
        errors: [
          {
            rowNumber: 0,
            code: 'TOO_MANY_ROWS',
            message: `At most ${cfg.maxRows} data rows are allowed; found ${body.length}.`,
          },
        ],
      };

    const rows: ParsedRow<CanonicalRelease>[] = [];
    body.forEach((cells, i) => {
      const rowNumber = i + 2;
      const raw: Record<string, string> = {};
      header.forEach((h, j) => (raw[h] = (cells[j] ?? '').slice(0, 300)));
      if (cells.length !== header.length) {
        errors.push({
          rowNumber,
          code: 'COLUMN_COUNT',
          message: `Expected ${header.length} values, found ${cells.length}.`,
          raw,
        });
        return;
      }
      const get = (f: Field) => (cells[index[f]] ?? '').trim();
      const v: CanonicalRelease = {
        externalId: get('externalId'),
        schemeCode: get('schemeCode').toUpperCase(),
        amount: get('amount').replace(/,/g, ''),
        releaseDate: get('releaseDate'),
        reference: get('reference'),
      };
      const before = errors.length;
      const bad = (f: Field, code: string, message: string) =>
        errors.push({ rowNumber, field: cfg.columns[f], code, message, raw });
      if (!v.externalId || v.externalId.length > 200)
        bad('externalId', 'INVALID_EXTERNAL_ID', 'External ID is required (max 200 characters).');
      if (!/^[A-Z0-9-]{2,50}$/.test(v.schemeCode))
        bad('schemeCode', 'INVALID_SCHEME_CODE', 'Scheme code is required.');
      if (!MONEY.test(v.amount) || Number(v.amount) <= 0)
        bad(
          'amount',
          'INVALID_AMOUNT',
          'Amount must be a positive number with at most 2 decimals.',
        );
      if (!validDate(v.releaseDate))
        bad('releaseDate', 'INVALID_DATE', 'Release date must be a valid YYYY-MM-DD date.');
      if (v.reference.length < 3 || v.reference.length > 200)
        bad('reference', 'INVALID_REFERENCE', 'Reference must be 3–200 characters.');
      if (errors.length === before) rows.push({ rowNumber, value: v, raw });
    });
    return { rows, errors };
  },
};

export const ADAPTERS: Record<string, ImportAdapter<CanonicalRelease>> = {
  [csvFundReleaseAdapter.code]: csvFundReleaseAdapter,
};
