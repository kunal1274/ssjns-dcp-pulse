import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, ErrorBox, Field, Select, StatusPill, Table } from '../components/ui';
import { api, ApiError, errorText, inr } from '../lib/http';
import type { FinancialYear, Ref } from '../lib/types';

type Period = { id: string; code: string; financialYearId: string };
type Bands = Record<string, number>;
export interface Kpis {
  schemeCount: number;
  activeSchemes: number;
  approvedBudget: string;
  originalBudget: string;
  allocatedBudget: string;
  verifiedReleases: string;
  verifiedExpenditure: string;
  reportedExpenditure: string;
  openCommitments: string;
  financialUtilisationPercent: string | null;
  financialUtilisationDenominator: string;
  releaseUtilisationPercent: string | null;
  releaseUtilisationDenominator: string;
  budgetRemaining: string;
  unreleasedAllocation: string;
  unspentReleasedFunds: string;
  pendingProgressSubmissions: number;
  pendingFinancialVerification: number;
  openAlerts: number;
  delayedSchemes: number;
  delayedMilestones: number;
  schemesRequiringAction: number;
  progressBands: Bands;
  lastVerifiedAt: string | null;
}
export interface SchemeMetrics {
  id: string;
  schemeCode: string;
  name: string;
  category: string;
  status: string;
  approvedBudget: string | null;
  allocatedBudget: string;
  verifiedReleases: string;
  verifiedExpenditure: string;
  reportedExpenditure: string;
  financialUtilisationPercent: string | null;
  releaseUtilisationPercent: string | null;
  physicalCompletionPercent: string | null;
  plannedProgressPercent: string | null;
  scheduleVariancePoints: string | null;
  physicalFinancialDifferencePoints: string | null;
  milestones: number;
  milestonesCompleted: number;
  milestonesDelayed: number;
  delayed: boolean;
  pendingFinancialVerification: number;
  pendingProgressSubmissions: number;
  openAlerts: number;
  lastVerifiedPeriod: string | null;
}
interface Dashboard {
  jurisdiction: { id: string; code: string; name: string; type: string; parentId: string | null };
  scope: 'TENANT' | 'RESTRICTED';
  basis: string;
  generatedAt: string;
  filters: { period: { code: string } | null };
  totals: Kpis;
  comparison: {
    jurisdiction: { id: string; code: string; name: string; type: string };
    kpis: Kpis | null;
  }[];
  directAtThisLevel: Kpis | null;
  statusBreakdown: { status: string; n: number }[];
  delayedSchemes: { total: number; items: SchemeMetrics[] };
  reportingCompleteness: {
    period: { code: string } | null;
    expected: number;
    submitted: number;
    percent: string | null;
  };
}

export const pct = (v: string | null | undefined) => (v == null ? 'N/A' : `${v}%`);
const lakh = (v: string | null) => (v == null ? 0 : Number(v) / 100000);

function Kpi({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string | number;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Freshness({ at, generatedAt }: { at: string | null; generatedAt: string }) {
  const days = at ? Math.floor((Date.parse(generatedAt) - Date.parse(at)) / 86400000) : null;
  const stale = days == null || days > 45;
  return (
    <span
      data-testid="freshness"
      className={`rounded px-2 py-1 text-xs ${stale ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}
    >
      Last verified update: {at ? `${new Date(at).toLocaleString()} (${days} days ago)` : 'none'} ·
      generated {new Date(generatedAt).toLocaleString()}
    </span>
  );
}

function useFilterOptions() {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [agencies, setAgencies] = useState<Ref[]>([]);
  const [options, setOptions] = useState<{ categories: string[]; departments: string[] }>({
    categories: [],
    departments: [],
  });
  useEffect(() => {
    void api<typeof options>('/dashboards/filter-options')
      .then(setOptions)
      .catch(() => undefined);
    void api<FinancialYear[]>('/budget/financial-years')
      .then(setYears)
      .catch(() => undefined);
    void api<Period[]>('/budget/periods')
      .then(setPeriods)
      .catch(() => undefined);
    void api<Ref[]>('/agencies')
      .then(setAgencies)
      .catch(() => undefined);
  }, []);
  return { years, periods, agencies, options };
}

const FILTER_KEYS = ['financialYearId', 'periodId', 'category', 'department', 'agencyId'] as const;

function Filters() {
  const [params, setParams] = useSearchParams();
  const { years, periods, agencies, options } = useFilterOptions();
  const fy = params.get('financialYearId') ?? '';
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'financialYearId') next.delete('periodId');
    setParams(next);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Dashboard filters">
      <Field label="Financial year">
        <Select
          value={fy}
          onChange={(e) => set('financialYearId', e.target.value)}
          data-testid="filter-fy"
        >
          <option value="">All</option>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.code}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reporting period (cumulative to)">
        <Select
          value={params.get('periodId') ?? ''}
          onChange={(e) => set('periodId', e.target.value)}
          data-testid="filter-period"
        >
          <option value="">Latest (all recorded)</option>
          {periods
            .filter((p) => !fy || p.financialYearId === fy)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Scheme category">
        <Select
          value={params.get('category') ?? ''}
          onChange={(e) => set('category', e.target.value)}
          data-testid="filter-category"
        >
          <option value="">All</option>
          {options.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Implementing agency">
        <Select
          value={params.get('agencyId') ?? ''}
          onChange={(e) => set('agencyId', e.target.value)}
        >
          <option value="">All</option>
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Department">
        <input
          className="w-full rounded border border-slate-300 px-2 py-1"
          defaultValue={params.get('department') ?? ''}
          onBlur={(e) => set('department', e.target.value.trim())}
          placeholder="Any"
        />
      </Field>
    </div>
  );
}

function useQueryString() {
  const [params] = useSearchParams();
  return useMemo(() => {
    const q = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [params]);
}

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    setError(null);
    setDenied(false);
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e) => {
        if (!live) return;
        setData(null);
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setDenied(true);
        else setError(errorText(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error, denied, loading };
}

export function LoadState({
  loading,
  error,
  denied,
}: {
  loading: boolean;
  error: string | null;
  denied: boolean;
}) {
  if (denied)
    return (
      <p
        role="alert"
        data-testid="dashboard-denied"
        className="rounded border border-amber-300 bg-amber-50 p-3"
      >
        Access denied: this view is outside your assigned jurisdiction or permissions.
      </p>
    );
  if (error) return <ErrorBox error={error} />;
  if (loading) return <p data-testid="dashboard-loading">Loading…</p>;
  return null;
}

function KpiGrid({ k }: { k: Kpis }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi-grid">
      <Kpi
        label="Schemes (active)"
        value={`${k.schemeCount} (${k.activeSchemes})`}
        testId="kpi-schemes"
      />
      <Kpi
        label="Approved budget (revised)"
        value={inr(k.approvedBudget)}
        hint={`Original ${inr(k.originalBudget)}`}
        testId="kpi-approved"
      />
      <Kpi
        label="Allocated (top-level)"
        value={inr(k.allocatedBudget)}
        hint={`Unreleased ${inr(k.unreleasedAllocation)}`}
      />
      <Kpi
        label="Funds released (verified)"
        value={inr(k.verifiedReleases)}
        hint={`Unspent ${inr(k.unspentReleasedFunds)}`}
        testId="kpi-released"
      />
      <Kpi
        label="Expenditure (verified)"
        value={inr(k.verifiedExpenditure)}
        hint={`Reported ${inr(k.reportedExpenditure)}`}
        testId="kpi-verified-exp"
      />
      <Kpi
        label="Financial utilisation"
        value={pct(k.financialUtilisationPercent)}
        hint={`of approved ${inr(k.financialUtilisationDenominator)}`}
        testId="kpi-fin-util"
      />
      <Kpi
        label="Release utilisation"
        value={pct(k.releaseUtilisationPercent)}
        hint={`of released ${inr(k.releaseUtilisationDenominator)}`}
      />
      <Kpi label="Budget remaining" value={inr(k.budgetRemaining)} />
      <Kpi
        label="Delayed schemes"
        value={k.delayedSchemes}
        hint={`${k.delayedMilestones} delayed milestones`}
        testId="kpi-delayed"
      />
      <Kpi label="Pending progress reviews" value={k.pendingProgressSubmissions} />
      <Kpi label="Pending finance verification" value={k.pendingFinancialVerification} />
      <Kpi
        label="Open alerts"
        value={k.openAlerts}
        hint={`${k.schemesRequiringAction} schemes need attention`}
        testId="kpi-alerts"
      />
    </div>
  );
}

function SchemeTable({ items }: { items: SchemeMetrics[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">No schemes match.</p>;
  return (
    <Table
      head={[
        'Scheme',
        'Status',
        'Physical (planned)',
        'Fin. util.',
        'Gap (pts)',
        'Delayed milestones',
        'Alerts',
      ]}
    >
      {items.map((s) => (
        <tr
          key={s.id}
          className="border-t border-slate-100"
          data-testid={`dash-scheme-${s.schemeCode}`}
        >
          <td className="p-2">
            <Link className="text-blue-700 underline" to={`/dashboards/scheme/${s.id}`}>
              {s.schemeCode}
            </Link>{' '}
            {s.name}
          </td>
          <td className="p-2">
            <StatusPill status={s.status} />
          </td>
          <td className="p-2">
            {pct(s.physicalCompletionPercent)} ({pct(s.plannedProgressPercent)})
          </td>
          <td className="p-2">{pct(s.financialUtilisationPercent)}</td>
          <td className="p-2">{s.physicalFinancialDifferencePoints ?? 'N/A'}</td>
          <td className="p-2">{s.milestonesDelayed}</td>
          <td className="p-2">{s.openAlerts}</td>
        </tr>
      ))}
    </Table>
  );
}

export function DashboardPage() {
  const { id } = useParams();
  const qs = useQueryString();
  const { data, error, denied, loading } = useLoad<Dashboard>(
    id ? `/dashboards/district/${id}${qs}` : `/dashboards/state${qs}`,
  );
  const comparison = (data?.comparison ?? []).map((c) => ({
    name: c.jurisdiction.code,
    'Approved (₹ lakh)': lakh(c.kpis?.approvedBudget ?? null),
    'Released (₹ lakh)': lakh(c.kpis?.verifiedReleases ?? null),
    'Verified spend (₹ lakh)': lakh(c.kpis?.verifiedExpenditure ?? null),
  }));
  const bands = data
    ? Object.entries(data.totals.progressBands).map(([band, n]) => ({ band, Schemes: n }))
    : [];
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold" data-testid="dashboard-title">
        {data
          ? `${data.jurisdiction.name} (${data.jurisdiction.type}) dashboard`
          : 'Monitoring dashboard'}
      </h1>
      {data?.jurisdiction.parentId && (
        <Link
          className="text-sm text-blue-700 underline"
          to={`/dashboards/jurisdiction/${data.jurisdiction.parentId}`}
        >
          ↑ Up one level
        </Link>
      )}
      <Card title="Filters">
        <Filters />
      </Card>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Freshness at={data.totals.lastVerifiedAt} generatedAt={data.generatedAt} />
            {data.scope === 'RESTRICTED' && (
              <span className="rounded bg-blue-100 px-2 py-1 text-blue-900">
                Figures limited to your assigned scope
              </span>
            )}
            {data.filters.period && (
              <span className="rounded bg-slate-200 px-2 py-1">
                Cumulative to {data.filters.period.code}
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-slate-600" data-testid="data-basis">
            Data basis: {data.basis}
          </p>
          {data.totals.schemeCount === 0 ? (
            <p
              data-testid="dashboard-empty"
              className="rounded border border-slate-200 bg-white p-3"
            >
              No monitored schemes match these filters.
            </p>
          ) : (
            <KpiGrid k={data.totals} />
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Budget vs release vs verified expenditure">
              <div className="h-64" data-testid="chart-comparison">
                <ResponsiveContainer>
                  <BarChart data={comparison}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Approved (₹ lakh)" fill="#94a3b8" />
                    <Bar dataKey="Released (₹ lakh)" fill="#60a5fa" />
                    <Bar dataKey="Verified spend (₹ lakh)" fill="#1d4ed8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Physical progress bands (verified, per scheme)">
              <div className="h-64" data-testid="chart-bands">
                <ResponsiveContainer>
                  <BarChart data={bands}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="band" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="Schemes" fill="#059669" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500">
                No average physical percentage is shown: schemes measure progress in different
                units.
              </p>
            </Card>
          </div>
          <Card title="Comparison by sub-jurisdiction">
            <Table
              head={[
                'Jurisdiction',
                'Schemes',
                'Approved',
                'Released',
                'Verified spend',
                'Fin. util.',
                'Delayed',
                'Alerts',
              ]}
            >
              {data.comparison.map((c) => (
                <tr
                  key={c.jurisdiction.id}
                  className="border-t border-slate-100"
                  data-testid={`compare-${c.jurisdiction.code}`}
                >
                  <td className="p-2">
                    <Link
                      className="text-blue-700 underline"
                      to={`/dashboards/jurisdiction/${c.jurisdiction.id}`}
                    >
                      {c.jurisdiction.name}
                    </Link>{' '}
                    <span className="text-xs text-slate-500">{c.jurisdiction.type}</span>
                  </td>
                  <td className="p-2">{c.kpis?.schemeCount ?? 0}</td>
                  <td className="p-2">{inr(c.kpis?.approvedBudget ?? '0')}</td>
                  <td className="p-2">{inr(c.kpis?.verifiedReleases ?? '0')}</td>
                  <td className="p-2">{inr(c.kpis?.verifiedExpenditure ?? '0')}</td>
                  <td className="p-2">{pct(c.kpis?.financialUtilisationPercent)}</td>
                  <td className="p-2">{c.kpis?.delayedSchemes ?? 0}</td>
                  <td className="p-2">{c.kpis?.openAlerts ?? 0}</td>
                </tr>
              ))}
              {data.directAtThisLevel && (
                <tr className="border-t border-slate-100">
                  <td className="p-2 italic">Recorded directly at this level</td>
                  <td className="p-2">{data.directAtThisLevel.schemeCount}</td>
                  <td className="p-2">{inr(data.directAtThisLevel.approvedBudget)}</td>
                  <td className="p-2">{inr(data.directAtThisLevel.verifiedReleases)}</td>
                  <td className="p-2">{inr(data.directAtThisLevel.verifiedExpenditure)}</td>
                  <td className="p-2">{pct(data.directAtThisLevel.financialUtilisationPercent)}</td>
                  <td className="p-2">{data.directAtThisLevel.delayedSchemes}</td>
                  <td className="p-2">{data.directAtThisLevel.openAlerts}</td>
                </tr>
              )}
            </Table>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Scheme status">
              <ul className="text-sm" data-testid="status-breakdown">
                {data.statusBreakdown.map((s) => (
                  <li key={s.status}>
                    <StatusPill status={s.status} /> {s.n}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Reporting completeness">
              <p className="text-sm" data-testid="completeness">
                {data.reportingCompleteness.period
                  ? `${data.reportingCompleteness.period.code}: ${data.reportingCompleteness.submitted} of ${data.reportingCompleteness.expected} schemes reported (${pct(data.reportingCompleteness.percent)})`
                  : 'No reporting period is due yet.'}
              </p>
              <p className="mt-2 text-sm">
                <Link className="text-blue-700 underline" to="/verification">
                  Pending approvals:{' '}
                  {data.totals.pendingProgressSubmissions +
                    data.totals.pendingFinancialVerification}
                </Link>
              </p>
            </Card>
          </div>
          <Card title={`Delayed schemes (${data.delayedSchemes.total})`}>
            <SchemeTable items={data.delayedSchemes.items} />
          </Card>
          <AreaSchemes jurisdictionId={id ?? null} qs={qs} />
        </>
      )}
    </div>
  );
}

/** Every monitored scheme in the area (paginated server-side, 100 per page). */
function AreaSchemes({ jurisdictionId, qs }: { jurisdictionId: string | null; qs: string }) {
  const p = new URLSearchParams(qs.replace(/^\?/, ''));
  p.set('pageSize', '100');
  if (jurisdictionId) p.set('jurisdictionId', jurisdictionId);
  const { data, error, denied, loading } = useLoad<{ total: number; items: SchemeMetrics[] }>(
    `/dashboards/schemes?${p.toString()}`,
  );
  return (
    <Card title={`Schemes in this area${data ? ` (${data.total})` : ''}`}>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && <SchemeTable items={data.items} />}
      {data && data.total > data.items.length && (
        <p className="mt-2 text-xs text-slate-600">
          Showing the first {data.items.length}; narrow the filters to see the rest.
        </p>
      )}
    </Card>
  );
}

interface Scheme360 {
  scheme: {
    id: string;
    schemeCode: string;
    name: string;
    category: string;
    status: string;
    jurisdiction: { id: string; code: string; name: string };
    agency: Ref;
    financialYear: { code: string };
  };
  basis: string;
  generatedAt: string;
  metrics: SchemeMetrics | null;
  budgetVersions: {
    versionNumber: number;
    status: string;
    totalAmount: string;
    revisionReason: string | null;
  }[];
  progressTimeline: { id: string; period: string; version: number; status: string }[];
  approvalHistory: {
    entity_type: string;
    step: string;
    decision: string;
    reason: string | null;
    decided_at: string;
    actor: string;
  }[];
  alerts: { id: string; ruleCode: string; severity: string; status: string; detectedAt: string }[];
}

export function Scheme360Page() {
  const { id } = useParams();
  const qs = useQueryString();
  const { data, error, denied, loading } = useLoad<Scheme360>(`/dashboards/scheme/${id}${qs}`);
  const m = data?.metrics;
  return (
    <div>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && (
        <>
          <h1 className="text-xl font-semibold" data-testid="scheme360-title">
            {data.scheme.schemeCode} — {data.scheme.name}
          </h1>
          <p className="mb-2 text-sm text-slate-600">
            <Link
              className="text-blue-700 underline"
              to={`/dashboards/jurisdiction/${data.scheme.jurisdiction.id}`}
            >
              {data.scheme.jurisdiction.name}
            </Link>{' '}
            · {data.scheme.agency.name} · {data.scheme.category} · FY{' '}
            {data.scheme.financialYear.code} · <StatusPill status={data.scheme.status} /> ·{' '}
            <Link className="text-blue-700 underline" to={`/schemes/${data.scheme.id}`}>
              Scheme record
            </Link>
          </p>
          <p className="mb-3 text-xs text-slate-600">Data basis: {data.basis}</p>
          {m && (
            <>
              <div
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                data-testid="scheme360-kpis"
              >
                <Kpi label="Approved budget" value={inr(m.approvedBudget)} testId="s360-approved" />
                <Kpi
                  label="Released (verified)"
                  value={inr(m.verifiedReleases)}
                  testId="s360-released"
                />
                <Kpi
                  label="Expenditure (verified)"
                  value={inr(m.verifiedExpenditure)}
                  hint={`Reported ${inr(m.reportedExpenditure)}`}
                  testId="s360-spent"
                />
                <Kpi
                  label="Financial utilisation"
                  value={pct(m.financialUtilisationPercent)}
                  testId="s360-fin-util"
                />
                <Kpi label="Release utilisation" value={pct(m.releaseUtilisationPercent)} />
                <Kpi
                  label="Physical completion (verified)"
                  value={pct(m.physicalCompletionPercent)}
                  testId="s360-physical"
                />
                <Kpi
                  label="Planned progress"
                  value={pct(m.plannedProgressPercent)}
                  hint={`Variance ${m.scheduleVariancePoints ?? 'N/A'} pts`}
                />
                <Kpi
                  label="Physical–financial difference"
                  value={
                    m.physicalFinancialDifferencePoints == null
                      ? 'N/A'
                      : `${m.physicalFinancialDifferencePoints} pts`
                  }
                  hint="Review indicator, not evidence of misuse"
                  testId="s360-gap"
                />
              </div>
              <Card title="Physical vs financial">
                <div className="h-56" data-testid="chart-physical-financial">
                  <ResponsiveContainer>
                    <BarChart
                      data={[
                        { name: 'Planned physical', value: Number(m.plannedProgressPercent ?? 0) },
                        {
                          name: 'Verified physical',
                          value: Number(m.physicalCompletionPercent ?? 0),
                        },
                        {
                          name: 'Financial utilisation',
                          value: Number(m.financialUtilisationPercent ?? 0),
                        },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 100]} unit="%" />
                      <Tooltip />
                      <Bar dataKey="value" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-sm">
                  Milestones: {m.milestonesCompleted} of {m.milestones} complete,{' '}
                  {m.milestonesDelayed} delayed · last verified period{' '}
                  {m.lastVerifiedPeriod ?? 'none'}
                </p>
              </Card>
            </>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Budget versions">
              <Table head={['Version', 'Status', 'Amount', 'Reason']}>
                {data.budgetVersions.map((v) => (
                  <tr key={v.versionNumber} className="border-t border-slate-100">
                    <td className="p-2">{v.versionNumber}</td>
                    <td className="p-2">
                      <StatusPill status={v.status} />
                    </td>
                    <td className="p-2">{inr(v.totalAmount)}</td>
                    <td className="p-2">{v.revisionReason ?? '—'}</td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Alerts">
              {data.alerts.length === 0 ? (
                <p className="text-sm text-slate-500">No alerts.</p>
              ) : (
                <ul className="text-sm" data-testid="s360-alerts">
                  {data.alerts.map((a) => (
                    <li key={a.id}>
                      <Link className="text-blue-700 underline" to={`/alerts/${a.id}`}>
                        {a.ruleCode}
                      </Link>{' '}
                      {a.severity} · <StatusPill status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Progress reports">
            <Table head={['Period', 'Version', 'Status']}>
              {data.progressTimeline.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="p-2">{t.period}</td>
                  <td className="p-2">{t.version}</td>
                  <td className="p-2">
                    <StatusPill status={t.status} />
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Approval history">
            <Table head={['When', 'Record', 'Step', 'Decision', 'By', 'Reason']}>
              {data.approvalHistory.map((h, i) => (
                <tr key={i} className="border-t border-slate-100" data-testid="s360-approval">
                  <td className="p-2">{new Date(h.decided_at).toLocaleString()}</td>
                  <td className="p-2">{h.entity_type}</td>
                  <td className="p-2">{h.step}</td>
                  <td className="p-2">{h.decision}</td>
                  <td className="p-2">{h.actor}</td>
                  <td className="p-2">{h.reason ?? '—'}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
