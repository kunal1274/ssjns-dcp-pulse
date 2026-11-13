import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Select, StatusPill, Table } from '../components/ui';
import { api, errorText, inr } from '../lib/http';
import type {
  ExpenditureRecord,
  FundRelease,
  Page,
  ProgressSubmission,
  QueueItem,
  Scheme,
  SchemeFinance,
  SchemeProgress,
} from '../lib/types';
import { useWrite } from './BudgetPage';

const MONEY = '^\\d{1,16}(\\.\\d{1,2})?$';
const QTY = '^\\d{1,15}(\\.\\d{1,3})?$';
type Period = { id: string; code: string; financialYearId: string };
const pct = (v: string | null) => (v == null ? 'N/A' : `${v}%`);

function useSchemes() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  useEffect(() => {
    api<Page<Scheme>>('/schemes?pageSize=100')
      .then((p) =>
        setSchemes(p.items.filter((s) => s.status !== 'DRAFT' && s.status !== 'SUBMITTED')),
      )
      .catch(() => setSchemes([]));
  }, []);
  return schemes;
}

function usePeriods(scheme: Scheme | undefined) {
  const [periods, setPeriods] = useState<Period[]>([]);
  useEffect(() => {
    api<Period[]>('/budget/periods')
      .then(setPeriods)
      .catch(() => setPeriods([]));
  }, []);
  return periods.filter((p) => p.financialYearId === scheme?.financialYear.id);
}

const SchemePicker = ({
  schemes,
  value,
  onChange,
}: {
  schemes: Scheme[];
  value: string;
  onChange: (id: string) => void;
}) => (
  <Field label="Scheme">
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a scheme…</option>
      {schemes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.schemeCode} — {s.name}
        </option>
      ))}
    </Select>
  </Field>
);

/** Verified-basis finance and physical progress for one scheme (shown on the scheme page). */
export function SchemeMonitoringPanel({ schemeId }: { schemeId: string }) {
  const [fin, setFin] = useState<SchemeFinance | null>(null);
  const [prog, setProg] = useState<SchemeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      api<SchemeFinance>(`/schemes/${schemeId}/finance`),
      api<SchemeProgress>(`/schemes/${schemeId}/progress`),
    ])
      .then(([f, p]) => {
        setFin(f);
        setProg(p);
      })
      .catch((e) => setError(errorText(e)));
  }, [schemeId]);
  if (error) return <ErrorBox error={error} />;
  if (!fin || !prog) return null;
  const rows: [string, string][] = [
    ['Approved budget', inr(fin.approvedBudget)],
    ['Verified releases', inr(fin.verifiedReleases)],
    ['Pending releases', inr(fin.pendingReleases)],
    ['Verified expenditure', inr(fin.verifiedExpenditure)],
    ['Reported, not yet verified', inr(fin.reportedUnverifiedExpenditure)],
    ['Open commitments', inr(fin.openCommitments)],
    ['Release balance', inr(fin.releaseBalance)],
    ['Budget utilisation', pct(fin.budgetUtilisationPercent)],
    ['Release utilisation', pct(fin.releaseUtilisationPercent)],
    ['Physical completion', pct(prog.physicalCompletionPercent)],
  ];
  return (
    <div data-testid="monitoring-panel" className="mt-4">
      <h3 className="mb-2 font-semibold">Finance and physical progress (verified basis)</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
            <dt className="text-slate-600">{k}</dt>
            <dd className="font-medium" data-testid={`metric-${k}`}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        {fin.basis} {prog.basis}
      </p>
      {prog.milestones.length > 0 && (
        <Table head={['Milestone', 'Weight', 'Target', 'Verified quantity']}>
          {prog.milestones.map((m) => (
            <tr key={m.id}>
              <td className="px-2 py-1">{m.name}</td>
              <td className="px-2 py-1">{m.weight}</td>
              <td className="px-2 py-1">
                {m.targetQuantity} {m.unit}
              </td>
              <td className="px-2 py-1">{m.verifiedQuantity ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function FinancePage() {
  const { can, me } = useAuth();
  const schemes = useSchemes();
  const [schemeId, setSchemeId] = useState('');
  const scheme = schemes.find((s) => s.id === schemeId);
  const periods = usePeriods(scheme);
  const [releases, setReleases] = useState<FundRelease[]>([]);
  const [spend, setSpend] = useState<ExpenditureRecord[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!schemeId) return;
    api<Page<FundRelease>>(`/fund-releases?schemeId=${schemeId}&pageSize=100`).then((p) =>
      setReleases(p.items),
    );
    api<Page<ExpenditureRecord>>(`/expenditure?schemeId=${schemeId}&pageSize=100`).then((p) =>
      setSpend(p.items),
    );
  }, [schemeId, tick]);

  const release = useWrite(reload);
  const expenditure = useWrite(reload);
  const action = useWrite(reload);
  const [rel, setRel] = useState({ amount: '', releaseDate: '', reference: '' });
  const [exp, setExp] = useState({ periodId: '', amount: '', expenditureDate: '', reference: '' });
  const [corr, setCorr] = useState<{ kind: 'fund-releases' | 'expenditure'; id: string } | null>(
    null,
  );
  const [corrForm, setCorrForm] = useState({ amount: '', reason: '' });

  const submitRelease = async (e: FormEvent) => {
    e.preventDefault();
    if (await release.run('/fund-releases', { schemeId, ...rel }))
      setRel({ amount: '', releaseDate: '', reference: '' });
  };
  const submitExpenditure = async (e: FormEvent) => {
    e.preventDefault();
    if (await expenditure.run('/expenditure', { schemeId, ...exp }))
      setExp({ periodId: '', amount: '', expenditureDate: '', reference: '' });
  };
  const submitCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (corr && (await action.run(`/${corr.kind}/${corr.id}/corrections`, corrForm))) {
      setCorr(null);
      setCorrForm({ amount: '', reason: '' });
    }
  };

  return (
    <>
      <Card title="Releases and expenditure">
        <SchemePicker schemes={schemes} value={schemeId} onChange={setSchemeId} />
        {schemeId && <SchemeMonitoringPanel key={`${schemeId}-${tick}`} schemeId={schemeId} />}
      </Card>
      {schemeId && can('release.record') && (
        <Card title="Record a fund release">
          <form onSubmit={submitRelease} className="grid gap-3 md:grid-cols-4">
            <Field label="Release amount (INR)">
              <Input
                required
                pattern={MONEY}
                value={rel.amount}
                onChange={(e) => setRel({ ...rel, amount: e.target.value })}
              />
            </Field>
            <Field label="Release date">
              <Input
                required
                type="date"
                value={rel.releaseDate}
                onChange={(e) => setRel({ ...rel, releaseDate: e.target.value })}
              />
            </Field>
            <Field label="Release reference">
              <Input
                required
                minLength={3}
                value={rel.reference}
                onChange={(e) => setRel({ ...rel, reference: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={release.busy}>Record release</Button>
            </div>
          </form>
          <ErrorBox error={release.error} />
        </Card>
      )}
      {schemeId && can('expenditure.submit') && (
        <Card title="Submit expenditure">
          <form onSubmit={submitExpenditure} className="grid gap-3 md:grid-cols-5">
            <Field label="Reporting period">
              <Select
                required
                value={exp.periodId}
                onChange={(e) => setExp({ ...exp, periodId: e.target.value })}
              >
                <option value="">Select…</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expenditure amount (INR)">
              <Input
                required
                pattern={MONEY}
                value={exp.amount}
                onChange={(e) => setExp({ ...exp, amount: e.target.value })}
              />
            </Field>
            <Field label="Expenditure date">
              <Input
                required
                type="date"
                value={exp.expenditureDate}
                onChange={(e) => setExp({ ...exp, expenditureDate: e.target.value })}
              />
            </Field>
            <Field label="Bill or voucher reference">
              <Input
                required
                minLength={3}
                value={exp.reference}
                onChange={(e) => setExp({ ...exp, reference: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={expenditure.busy}>Submit expenditure</Button>
            </div>
          </form>
          <ErrorBox error={expenditure.error} />
        </Card>
      )}
      {schemeId && (
        <Card title="Records">
          <ErrorBox error={action.error} />
          {corr && (
            <form
              onSubmit={submitCorrection}
              className="mb-4 grid gap-3 rounded border border-amber-300 bg-amber-50 p-3 md:grid-cols-3"
            >
              <Field label="Corrected amount (INR)">
                <Input
                  required
                  pattern={MONEY}
                  value={corrForm.amount}
                  onChange={(e) => setCorrForm({ ...corrForm, amount: e.target.value })}
                />
              </Field>
              <Field label="Correction reason">
                <Input
                  required
                  minLength={10}
                  value={corrForm.reason}
                  onChange={(e) => setCorrForm({ ...corrForm, reason: e.target.value })}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button disabled={action.busy}>Submit correction</Button>
                <Button type="button" variant="secondary" onClick={() => setCorr(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <h3 className="mb-1 font-semibold">Fund releases</h3>
          <Table head={['Date', 'Reference', 'Amount', 'Status', '']}>
            {releases.map((r) => (
              <tr key={r.id} data-testid={`release-${r.reference}`}>
                <td className="px-2 py-1">{r.releaseDate.slice(0, 10)}</td>
                <td className="px-2 py-1">
                  {r.reference}
                  {r.supersedesId && (
                    <span className="ml-1 text-xs text-amber-700">(correction)</span>
                  )}
                </td>
                <td className="px-2 py-1">{inr(r.amount)}</td>
                <td className="px-2 py-1">
                  <StatusPill status={r.verificationStatus} />
                </td>
                <td className="px-2 py-1">
                  {r.verificationStatus === 'VERIFIED' && can('release.record') && (
                    <Button
                      variant="secondary"
                      onClick={() => setCorr({ kind: 'fund-releases', id: r.id })}
                    >
                      Correct
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <h3 className="mb-1 mt-4 font-semibold">Expenditure</h3>
          <Table head={['Period', 'Reference', 'Amount', 'Status', 'Note', '']}>
            {spend.map((x) => (
              <tr key={x.id} data-testid={`expenditure-${x.reference}`}>
                <td className="px-2 py-1">{x.period.code}</td>
                <td className="px-2 py-1">
                  {x.reference}
                  {x.supersedesId && (
                    <span className="ml-1 text-xs text-amber-700">(correction)</span>
                  )}
                </td>
                <td className="px-2 py-1">{inr(x.amount)}</td>
                <td className="px-2 py-1">
                  <StatusPill status={x.status} />
                </td>
                <td className="px-2 py-1 text-xs text-slate-600">
                  {x.decisionReason ?? x.correctionReason ?? ''}
                </td>
                <td className="px-2 py-1">
                  {x.status === 'RETURNED' && x.submittedById === me?.user.id && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        action.run(`/expenditure/${x.id}/resubmit`, { version: x.version })
                      }
                    >
                      Resubmit
                    </Button>
                  )}
                  {x.status === 'VERIFIED' && can('expenditure.submit') && (
                    <Button
                      variant="secondary"
                      onClick={() => setCorr({ kind: 'expenditure', id: x.id })}
                    >
                      Correct
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}

export function ProgressPage() {
  const { can, me } = useAuth();
  const schemes = useSchemes();
  const [schemeId, setSchemeId] = useState('');
  const scheme = schemes.find((s) => s.id === schemeId);
  const periods = usePeriods(scheme);
  const [progress, setProgress] = useState<SchemeProgress | null>(null);
  const [subs, setSubs] = useState<ProgressSubmission[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ProgressSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const write = useWrite(reload);
  useEffect(() => {
    if (!schemeId) return;
    api<SchemeProgress>(`/schemes/${schemeId}/progress`).then(setProgress);
    api<Page<ProgressSubmission>>(`/progress-submissions?schemeId=${schemeId}&pageSize=100`).then(
      (p) => setSubs(p.items),
    );
  }, [schemeId, tick]);

  const measurements = () =>
    Object.entries(qty)
      .filter(([, v]) => v !== '')
      .map(([milestoneId, quantityCompleted]) => ({ milestoneId, quantityCompleted }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (editing) {
      try {
        await api(`/progress-submissions/${editing.id}`, {
          method: 'PATCH',
          body: { version: editing.version, remarks, measurements: measurements() },
        });
        setEditing(null);
        setQty({});
        reload();
      } catch (err) {
        setError(errorText(err));
      }
      return;
    }
    if (
      await write.run('/progress-submissions', {
        schemeId,
        periodId,
        remarks,
        measurements: measurements(),
      })
    ) {
      setQty({});
      setRemarks('');
    }
  };
  const edit = (s: ProgressSubmission) => {
    setEditing(s);
    setRemarks(s.remarks ?? '');
    setQty(Object.fromEntries(s.measurements.map((m) => [m.milestoneId, m.quantityCompleted])));
  };

  return (
    <>
      <Card title="Physical progress">
        <SchemePicker schemes={schemes} value={schemeId} onChange={setSchemeId} />
        {progress && (
          <p className="mt-3 text-sm">
            Verified physical completion:{' '}
            <strong data-testid="physical-completion">
              {pct(progress.physicalCompletionPercent)}
            </strong>
            <span className="ml-2 text-xs text-slate-500">{progress.basis}</span>
          </p>
        )}
      </Card>
      {schemeId && progress && can('progress.submit') && (
        <Card
          title={
            editing ? `Edit returned submission (${editing.period.code})` : 'New progress draft'
          }
        >
          <form onSubmit={save} className="grid gap-3">
            {!editing && (
              <Field label="Progress period">
                <Select required value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">Select…</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {progress.milestones.map((m) => (
              <Field
                key={m.id}
                label={`${m.name} — cumulative ${m.unit} (target ${m.targetQuantity})`}
              >
                <Input
                  pattern={QTY}
                  value={qty[m.id] ?? ''}
                  onChange={(e) => setQty({ ...qty, [m.id]: e.target.value })}
                />
              </Field>
            ))}
            <Field label="Remarks">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button disabled={write.busy}>{editing ? 'Save changes' : 'Save draft'}</Button>
              {editing && (
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
          <ErrorBox error={error ?? write.error} />
        </Card>
      )}
      {schemeId && (
        <Card title="Submissions">
          <Table head={['Period', 'Version', 'Status', 'Measurements', 'Note', '']}>
            {subs.map((s) => {
              const mine = s.createdBy === me?.user.id;
              return (
                <tr key={s.id} data-testid={`submission-${s.period.code}-v${s.submissionVersion}`}>
                  <td className="px-2 py-1">{s.period.code}</td>
                  <td className="px-2 py-1">v{s.submissionVersion}</td>
                  <td className="px-2 py-1">
                    <StatusPill status={s.status} />
                  </td>
                  <td className="px-2 py-1 text-xs">
                    {s.measurements
                      .map((m) => `${m.milestone.name}: ${m.quantityCompleted}`)
                      .join('; ')}
                  </td>
                  <td className="px-2 py-1 text-xs text-slate-600">{s.decisionReason ?? ''}</td>
                  <td className="flex gap-1 px-2 py-1">
                    {mine && (s.status === 'DRAFT' || s.status === 'RETURNED') && (
                      <>
                        {s.status === 'RETURNED' && (
                          <Button variant="secondary" onClick={() => edit(s)}>
                            Edit
                          </Button>
                        )}
                        <Button
                          onClick={() =>
                            write.run(`/progress-submissions/${s.id}/submit`, {
                              version: s.version,
                            })
                          }
                        >
                          {s.status === 'RETURNED' ? 'Resubmit' : 'Submit'}
                        </Button>
                      </>
                    )}
                    {s.status === 'VERIFIED' && can('progress.submit') && (
                      <Button
                        variant="secondary"
                        onClick={() => write.run(`/progress-submissions/${s.id}/corrections`, {})}
                      >
                        Correct
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </>
  );
}

const DECIDE: Record<QueueItem['kind'], (id: string) => string> = {
  FUND_RELEASE: (id) => `/fund-releases/${id}/decision`,
  EXPENDITURE: (id) => `/expenditure/${id}/decision`,
  PROGRESS: (id) => `/progress-submissions/${id}`,
};

export function VerificationQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ items: QueueItem[] }>('/verification-queue')
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  const write = useWrite(load);
  const decide = (i: QueueItem, decision: 'VERIFY' | 'RETURN' | 'REJECT') => {
    const reason = reasons[i.id]?.trim() || undefined;
    if (i.kind === 'PROGRESS')
      return decision === 'VERIFY'
        ? write.run(`${DECIDE.PROGRESS(i.id)}/verify`, { version: i.version })
        : write.run(`${DECIDE.PROGRESS(i.id)}/return`, {
            version: i.version,
            reason: reason ?? '',
          });
    return write.run(DECIDE[i.kind](i.id), { version: i.version, decision, reason });
  };
  return (
    <Card title="Verification queue">
      <p className="mb-3 text-sm text-slate-600">
        Items awaiting a checker in your scope. Your own submissions never appear here.
      </p>
      <ErrorBox error={error ?? write.error} />
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing awaiting your decision.</p>
      ) : (
        <Table head={['Type', 'Scheme', 'Details', 'Status', 'Reason', 'Decision']}>
          {items.map((i) => (
            <tr key={i.id} data-testid={`queue-${i.kind}-${i.reference ?? i.period}`}>
              <td className="px-2 py-1 text-xs">
                {i.kind.replace('_', ' ')}
                {i.isCorrection && <span className="ml-1 text-amber-700">(correction)</span>}
              </td>
              <td className="px-2 py-1">{i.scheme.schemeCode}</td>
              <td className="px-2 py-1 text-xs">
                {[i.amount && inr(i.amount), i.reference, i.period, i.correctionReason]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
              <td className="px-2 py-1">
                <StatusPill status={i.status} />
              </td>
              <td className="px-2 py-1">
                <Input
                  aria-label="Decision reason"
                  value={reasons[i.id] ?? ''}
                  onChange={(e) => setReasons({ ...reasons, [i.id]: e.target.value })}
                />
              </td>
              <td className="flex gap-1 px-2 py-1">
                <Button disabled={write.busy} onClick={() => decide(i, 'VERIFY')}>
                  Verify
                </Button>
                {i.kind !== 'FUND_RELEASE' && (
                  <Button
                    variant="secondary"
                    disabled={write.busy}
                    onClick={() => decide(i, 'RETURN')}
                  >
                    Return
                  </Button>
                )}
                {i.kind !== 'PROGRESS' && (
                  <Button
                    variant="danger"
                    disabled={write.busy}
                    onClick={() => decide(i, 'REJECT')}
                  >
                    Reject
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
