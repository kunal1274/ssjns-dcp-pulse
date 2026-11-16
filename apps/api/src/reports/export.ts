import ExcelJS from 'exceljs';
import type { Column } from './definitions';

export type Cell = string | number | boolean | Date | null;
export interface ReportOutput {
  title: string;
  meta: [string, string][];
  columns: Column[];
  rows: Record<string, Cell>[];
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Neutralises spreadsheet formula injection (OWASP): prefix risky leading characters with '. */
export function sanitize(v: string): string {
  return /^[=+\-@\t\r|%]/.test(v) && !NUMERIC.test(v) ? `'${v}` : v;
}

export function text(col: Column, v: Cell): string {
  if (v === null || v === undefined) return col.type === 'percent' ? 'N/A' : '';
  if (v instanceof Date)
    return col.type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(r: ReportOutput): Buffer {
  const lines: string[] = [];
  for (const [k, v] of r.meta) lines.push([k, v].map((x) => quote(sanitize(x))).join(','));
  lines.push('');
  lines.push(r.columns.map((c) => quote(sanitize(c.label))).join(','));
  for (const row of r.rows)
    lines.push(r.columns.map((c) => quote(sanitize(text(c, row[c.key])))).join(','));
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
}

export async function toXlsx(r: ReportOutput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DCP Pulse (synthetic demonstration)';
  const ws = wb.addWorksheet('Report');
  ws.addRow(r.columns.map((c) => c.label)).font = { bold: true };
  for (const row of r.rows) {
    ws.addRow(
      r.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined) return c.type === 'percent' ? 'N/A' : null;
        if (
          (c.type === 'money' || c.type === 'percent' || c.type === 'int') &&
          typeof v === 'string' &&
          NUMERIC.test(v)
        )
          return Number(v);
        if (v instanceof Date)
          return c.type === 'date' ? v.toISOString().slice(0, 10) : v.toISOString();
        return typeof v === 'string' ? sanitize(v) : v;
      }),
    );
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(45, Math.max(12, c.label.length + 2));
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'percent') col.numFmt = '0.00';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const meta = wb.addWorksheet('Metadata');
  for (const [k, v] of r.meta) meta.addRow([sanitize(k), sanitize(v)]);
  meta.getColumn(1).width = 28;
  meta.getColumn(2).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
