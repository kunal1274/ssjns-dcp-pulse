import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Select, StatusPill, Table } from '../components/ui';
import { api, errorText, inr } from '../lib/http';
import type { FinancialYear, Jurisdiction, Page, Ref, Scheme } from '../lib/types';

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
];

function useRefs() {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [agencies, setAgencies] = useState<Ref[]>([]);
  useEffect(() => {
    void api<FinancialYear[]>('/budget/financial-years')
      .then(setYears)
      .catch(() => setYears([]));
    void api<Jurisdiction[]>('/jurisdictions')
      .then(setJurisdictions)
      .catch(() => setJurisdictions([]));
    void api<Ref[]>('/agencies')
      .then(setAgencies)
      .catch(() => setAgencies([]));
  }, []);
  return { years, jurisdictions, agencies };
}

export function SchemeListPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Page<Scheme> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? '1');
  const status = params.get('status') ?? '';

  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) qs.set('status', status);
    if (params.get('q')) qs.set('q', params.get('q')!);
    api<Page<Scheme>>(`/schemes?${qs}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [page, status, params]);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setParams(n);
  };

  return (
    <Card
      title="Scheme register"
      actions={
        can('scheme.create') && (
          <Link className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white" to="/schemes/new">
            New scheme
          </Link>
        )
      }
    >
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          set('q', q);
        }}
      >
        <Field label="Search code or name">
          <Input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select
            aria-label="Status filter"
            value={status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <ErrorBox error={error} />
      {data && (
        <>
          <Table
            head={[
              'Code',
              'Name',
              'Jurisdiction',
              'Agency',
              'FY',
              'Status',
              'Approved budget',
              'Allocated',
            ]}
          >
            {data.items.map((s) => (
              <tr key={s.id}>
                <td className="px-2 py-1.5 font-mono">
                  <Link className="text-blue-700 underline" to={`/schemes/${s.id}`}>
                    {s.schemeCode}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{s.name}</td>
                <td className="px-2 py-1.5">{s.jurisdiction.name}</td>
                <td className="px-2 py-1.5">{s.agency.code}</td>
                <td className="px-2 py-1.5">{s.financialYear.code}</td>
                <td className="px-2 py-1.5">
                  <StatusPill status={s.status} />
                </td>
                <td className="px-2 py-1.5 text-right">{inr(s.approvedBudget)}</td>
                <td className="px-2 py-1.5 text-right">{inr(s.allocatedAmount)}</td>
              </tr>
            ))}
          </Table>
          {data.items.length === 0 && (
            <p className="p-2 text-sm text-slate-500">No schemes in your scope match.</p>
          )}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => set('page', String(page - 1))}
            >
              Previous
            </Button>
            <span>
              Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} ({data.total}{' '}
              schemes)
            </span>
            <Button
              variant="secondary"
              disabled={page * data.pageSize >= data.total}
              onClick={() => set('page', String(page + 1))}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export function SchemeCreatePage() {
  const { years, jurisdictions, agencies } = useRefs();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    setBusy(true);
    try {
      const s = await api<Scheme>('/schemes', { method: 'POST', body });
      nav(`/schemes/${s.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Register scheme (draft)">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Scheme reference">
          <Input name="schemeCode" required maxLength={50} />
        </Field>
        <Field label="Title">
          <Input name="name" required maxLength={200} />
        </Field>
        <Field label="Category">
          <Input name="category" required maxLength={100} />
        </Field>
        <Field label="Department">
          <Input name="department" maxLength={150} />
        </Field>
        <Field label="Financial year">
          <Select name="financialYearId" required>
            <option value="">Select…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="District / co-district">
          <Select name="jurisdictionId" required>
            <option value="">Select…</option>
            {jurisdictions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.type.displayName})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Implementing agency">
          <Select name="agencyId" required>
            <option value="">Select…</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Proposed budget (INR)">
          <Input name="proposedBudget" inputMode="decimal" pattern="^\d{1,16}(\.\d{1,2})?$" />
        </Field>
        <Field label="Start date">
          <Input name="startDate" type="date" />
        </Field>
        <Field label="Target end date">
          <Input name="targetEndDate" type="date" />
        </Field>
        <Field label="Description">
          <textarea name="description" className="rounded border border-slate-300 p-2" />
        </Field>
        <Field label="Objectives">
          <textarea name="objectives" className="rounded border border-slate-300 p-2" />
        </Field>
        <div className="md:col-span-2">
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy}>
            Save draft
          </Button>
        </div>
      </form>
    </Card>
  );
}

const NEXT: Record<string, string[]> = {
  APPROVED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
};

export function SchemeDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const [s, setS] = useState<Scheme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => {
    api<Scheme>(`/schemes/${id}`)
      .then(setS)
      .catch((e) => setError(errorText(e)));
  }, [id]);
  useEffect(load, [load]);

  const act = async (path: string, body: object) => {
    setError(null);
    try {
      setS(
        await api<Scheme>(`/schemes/${id}/${path}`, {
          method: 'POST',
          body: { version: s!.version, ...body },
        }),
      );
      setReason('');
    } catch (e) {
      setError(errorText(e));
      load();
    }
  };
  if (!s) return <ErrorBox error={error} />;
  const own = s.createdBy === me?.user.id || s.submittedBy === me?.user.id;
  return (
    <Card title={`${s.schemeCode} — ${s.name}`} actions={<StatusPill status={s.status} />}>
      <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-sm">
        <dt className="text-slate-500">Category</dt>
        <dd>{s.category}</dd>
        <dt className="text-slate-500">Department</dt>
        <dd>{s.department ?? '—'}</dd>
        <dt className="text-slate-500">Jurisdiction</dt>
        <dd>{s.jurisdiction.name}</dd>
        <dt className="text-slate-500">Implementing agency</dt>
        <dd>{s.agency.name}</dd>
        <dt className="text-slate-500">Financial year</dt>
        <dd>{s.financialYear.code}</dd>
        <dt className="text-slate-500">Proposed budget</dt>
        <dd>{inr(s.proposedBudget)}</dd>
        <dt className="text-slate-500">Approved budget</dt>
        <dd>{inr(s.approvedBudget)}</dd>
        <dt className="text-slate-500">Allocated (approved)</dt>
        <dd>{inr(s.allocatedAmount)}</dd>
        <dt className="text-slate-500">Dates</dt>
        <dd>
          {s.startDate?.slice(0, 10) ?? '—'} → {s.targetEndDate?.slice(0, 10) ?? '—'}
        </dd>
        <dt className="text-slate-500">Description</dt>
        <dd>{s.description ?? '—'}</dd>
        <dt className="text-slate-500">Objectives</dt>
        <dd>{s.objectives ?? '—'}</dd>
        {s.statusReason && (
          <>
            <dt className="text-slate-500">Status reason</dt>
            <dd>{s.statusReason}</dd>
          </>
        )}
      </dl>
      <ErrorBox error={error} />
      <div className="mt-4 flex flex-wrap items-end gap-2">
        {s.status === 'DRAFT' && can('scheme.submit') && (
          <Button onClick={() => void act('submit', {})}>Submit for approval</Button>
        )}
        {s.status === 'SUBMITTED' && can('scheme.approve') && (
          <>
            {own && (
              <p className="w-full text-xs text-amber-800">
                You submitted this scheme; another officer must approve it.
              </p>
            )}
            <Field label="Comment / reason">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              onClick={() =>
                void act('decision', { decision: 'APPROVE', comment: reason || undefined })
              }
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void act('decision', { decision: 'RETURN', comment: reason || undefined })
              }
            >
              Return to draft
            </Button>
          </>
        )}
        {NEXT[s.status] && can('scheme.approve') && (
          <>
            <Field label="Reason (required for hold/cancel)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {NEXT[s.status].map((to) => (
              <Button
                key={to}
                variant={to === 'CANCELLED' ? 'danger' : 'secondary'}
                onClick={() => void act('transition', { to, reason: reason || undefined })}
              >
                Mark {to.toLowerCase()}
              </Button>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}
