import { useEffect, useMemo, useState } from 'react';
import { Card, ErrorBox, Field, Input, Select, Table } from '../components/ui';
import { api, errorText } from '../lib/http';
import type { FinancialYear, Jurisdiction, Period } from '../lib/types';
import { useApi } from '../lib/useApi';
import { LoadState } from './DashboardPages';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

interface Column {
  key: string;
  label: string;
  type: string;
}
interface Definition {
  code: string;
  title: string;
  description: string;
  requiresScheme?: boolean;
  extraPermission?: string;
  columns: Column[];
}
interface Preview {
  title: string;
  meta: [string, string][];
  columns: Column[];
  total: number;
  truncated: boolean;
  rows: Record<string, string | number | boolean | null>[];
}

const cell = (c: Column, v: string | number | boolean | null | undefined) => {
  if (v === null || v === undefined) return c.type === 'percent' ? 'N/A' : '—';
  if (c.type === 'money')
    return Number(v).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (c.type === 'datetime') return new Date(String(v)).toLocaleString('en-IN');
  if (c.type === 'date') return String(v).slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

export function ReportsPage() {
  const defs = useApi<{ canExport: boolean; notice: string; items: Definition[] }>('/reports');
  const { data: years } = useApi<FinancialYear[]>('/budget/financial-years');
  const { data: periods } = useApi<Period[]>('/budget/periods');
  const { data: jurisdictions } = useApi<Jurisdiction[]>('/jurisdictions');
  const { data: schemes } = useApi<{ items: { id: string; schemeCode: string; name: string }[] }>(
    '/schemes?pageSize=100',
  );
  const [code, setCode] = useState('state-summary');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const def = defs.data?.items.find((d) => d.code === code);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [filters]);

  useEffect(() => {
    if (!def || (def.requiresScheme && !filters.schemeId)) {
      setPreview(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api<Preview>(`/reports/${code}?${qs}`)
      .then((d) => live && setPreview(d))
      .catch((e) => live && (setPreview(null), setError(errorText(e))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [code, qs, def, filters.schemeId]);

  const set = (k: string, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const yearPeriods = (periods ?? []).filter(
    (p) => !filters.financialYearId || p.financialYearId === filters.financialYearId,
  );
  const href = (format: string) =>
    `${BASE}/reports/${code}/export?format=${format}${qs ? `&${qs}` : ''}`;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">MIS reports</h1>
      <p className="mb-4 text-sm text-slate-600">
        Generated on the server from the same calculations as the dashboards. Exports are streamed,
        not stored, and each one is recorded in the audit history. {defs.data?.notice}
      </p>
      <LoadState loading={defs.loading && !defs.data} error={defs.error} denied={defs.denied} />
      {defs.data && (
        <>
          <Card title="Report and filters">
            <div className="flex flex-wrap gap-3">
              <Field label="Report">
                <Select aria-label="Report" value={code} onChange={(e) => setCode(e.target.value)}>
                  {defs.data.items.map((d, i) => (
                    <option key={d.code} value={d.code}>
                      {i + 1}. {d.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Jurisdiction">
                <Select
                  aria-label="Jurisdiction"
                  value={filters.jurisdictionId ?? ''}
                  onChange={(e) => set('jurisdictionId', e.target.value)}
                >
                  <option value="">All within my scope</option>
                  {jurisdictions?.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Financial year">
                <Select
                  aria-label="Financial year"
                  value={filters.financialYearId ?? ''}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, financialYearId: e.target.value, periodId: '' }))
                  }
                >
                  <option value="">All</option>
                  {years?.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reporting period (cumulative to)">
                <Select
                  aria-label="Reporting period"
                  value={filters.periodId ?? ''}
                  onChange={(e) => set('periodId', e.target.value)}
                >
                  <option value="">Latest</option>
                  {yearPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </Select>
              </Field>
              {def?.requiresScheme && (
                <Field label="Scheme">
                  <Select
                    aria-label="Scheme"
                    value={filters.schemeId ?? ''}
                    onChange={(e) => set('schemeId', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {schemes?.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.schemeCode} — {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {code === 'audit-activity' && (
                <>
                  <Field label="From">
                    <Input
                      type="date"
                      aria-label="From"
                      value={filters.from ?? ''}
                      onChange={(e) => set('from', e.target.value)}
                    />
                  </Field>
                  <Field label="To">
                    <Input
                      type="date"
                      aria-label="To"
                      value={filters.to ?? ''}
                      onChange={(e) => set('to', e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>
            {def && <p className="mt-2 text-sm text-slate-600">{def.description}</p>}
            <div className="mt-3 flex gap-2">
              {defs.data.canExport ? (
                <>
                  <a
                    className="rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white"
                    href={href('csv')}
                    download
                    data-testid="export-csv"
                  >
                    Export CSV
                  </a>
                  <a
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium"
                    href={href('xlsx')}
                    download
                    data-testid="export-xlsx"
                  >
                    Export Excel
                  </a>
                </>
              ) : (
                <span className="text-sm text-slate-600">
                  You can view reports but not export them (needs report.export).
                </span>
              )}
              <span className="self-center text-xs text-slate-500">
                PDF export: not implemented.
              </span>
            </div>
          </Card>
          <ErrorBox error={error} />
          {loading && <p className="text-sm text-slate-600">Generating…</p>}
          {def?.requiresScheme && !filters.schemeId && (
            <p className="text-sm text-slate-600">Choose a scheme to generate this report.</p>
          )}
          {preview && (
            <>
              <Card title="Report metadata">
                <dl
                  className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]"
                  data-testid="report-meta"
                >
                  {preview.meta.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-500">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <Card
                title={`${preview.title} — ${preview.total} row(s)${preview.truncated ? ' (first 200 shown; export for all)' : ''}`}
              >
                <div className="overflow-x-auto" data-testid="report-table">
                  <Table head={preview.columns.map((c) => c.label)}>
                    {preview.rows.map((r, i) => (
                      <tr key={i} data-testid="report-row">
                        {preview.columns.map((c) => (
                          <td
                            key={c.key}
                            className={`px-2 py-1 ${['money', 'percent', 'int'].includes(c.type) ? 'text-right tabular-nums' : ''}`}
                          >
                            {cell(c, r[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
