import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Select, StatusPill, Table } from '../components/ui';
import { api, errorText, inr, newIdempotencyKey } from '../lib/http';
import type {
  Allocation,
  Ceiling,
  FinancialYear,
  FundingRequest,
  Jurisdiction,
  Page,
  Revision,
  Scheme,
} from '../lib/types';

const MONEY = '^\\d{1,16}(\\.\\d{1,2})?$';

/** One idempotency key per logical write: re-submitting after a network error replays, not duplicates. */
export function useWrite(onDone: () => void) {
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body, idempotencyKey: key });
      setKey(newIdempotencyKey());
      onDone();
      return true;
    } catch (e) {
      setError(errorText(e));
      // Validation/business errors are final for this payload; only network failures should reuse the key.
      if (e instanceof Error && 'status' in e) setKey(newIdempotencyKey());
      onDone();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

export function BudgetPage() {
  const { can, me } = useAuth();
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [fy, setFy] = useState('');
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [ceilings, setCeilings] = useState<Ceiling[]>([]);
  const [ceilingId, setCeilingId] = useState('');
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canAllocate = can('budget.allocate');

  useEffect(() => {
    void api<FinancialYear[]>('/budget/financial-years')
      .then((y) => {
        setYears(y);
        setFy((cur) => cur || y[0]?.id || '');
      })
      .catch((e) => setLoadError(errorText(e)));
    void api<Jurisdiction[]>('/jurisdictions')
      .then(setJurisdictions)
      .catch(() => undefined);
  }, []);

  const reload = useCallback(() => {
    if (!fy) return;
    api<Ceiling[]>(`/budget/ceilings?financialYearId=${fy}`)
      .then((c) => {
        setCeilings(c);
        setCeilingId((cur) => (c.some((x) => x.id === cur) ? cur : (c[0]?.id ?? '')));
      })
      .catch((e) => setLoadError(errorText(e)));
    api<Page<Scheme>>(`/schemes?financialYearId=${fy}&pageSize=100`)
      .then((p) => setSchemes(p.items))
      .catch(() => setSchemes([]));
    if (can('budget.revise'))
      api<Revision[]>('/budget/revisions')
        .then(setRevisions)
        .catch(() => setRevisions([]));
  }, [fy, can]);
  useEffect(reload, [reload]);

  const reloadAllocations = useCallback(() => {
    if (!ceilingId) return setAllocations([]);
    api<Allocation[]>(`/budget/allocations?budgetVersionId=${ceilingId}`)
      .then(setAllocations)
      .catch((e) => setLoadError(errorText(e)));
  }, [ceilingId]);
  useEffect(reloadAllocations, [reloadAllocations]);

  const refreshAll = () => {
    reload();
    reloadAllocations();
  };
  const ceiling = ceilings.find((c) => c.id === ceilingId);
  const ordered = useMemo(() => orderTree(allocations), [allocations]);

  return (
    <>
      <Card title="Budget planning">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Financial year">
            <Select aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code} ({y.status})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <ErrorBox error={loadError} />
        <p className="mt-2 text-xs text-slate-500">
          All balances are calculated by the server. Each level counts only its immediate children,
          so district and scheme allocations are never double counted against the ceiling.
        </p>
      </Card>

      <Card title="Budget ceilings">
        <Table
          head={[
            'Jurisdiction',
            'Status',
            'Ceiling',
            'Allocated (approved)',
            'Pending',
            'Remaining',
            'Available',
            '',
          ]}
        >
          {ceilings.map((c) => (
            <tr
              key={c.id}
              className={c.id === ceilingId ? 'bg-blue-50' : ''}
              data-testid={`ceiling-${c.id}`}
            >
              <td className="px-2 py-1.5">{c.jurisdiction?.name ?? '—'}</td>
              <td className="px-2 py-1.5">
                <StatusPill status={c.status} />
              </td>
              <td className="px-2 py-1.5 text-right">{inr(c.totalAmount)}</td>
              <td className="px-2 py-1.5 text-right">{inr(c.allocatedApproved)}</td>
              <td className="px-2 py-1.5 text-right">{inr(c.allocatedPending)}</td>
              <td className="px-2 py-1.5 text-right font-semibold" data-testid="ceiling-remaining">
                {inr(c.remaining)}
              </td>
              <td className="px-2 py-1.5 text-right">{inr(c.available)}</td>
              <td className="px-2 py-1.5 space-x-1">
                <Button variant="secondary" onClick={() => setCeilingId(c.id)}>
                  View
                </Button>
                {c.status === 'DRAFT' && canAllocate && (
                  <ApproveButton
                    path={`/budget/ceilings/${c.id}/approve`}
                    version={c.version}
                    own={c.createdBy === me?.user.id}
                    onDone={refreshAll}
                  />
                )}
              </td>
            </tr>
          ))}
        </Table>
        {ceilings.length === 0 && (
          <p className="p-2 text-sm text-slate-500">No ceiling registered for this year.</p>
        )}
        {canAllocate && <CeilingForm fy={fy} jurisdictions={jurisdictions} onDone={refreshAll} />}
      </Card>

      {ceiling && (
        <Card title={`Allocations under ${ceiling.jurisdiction?.name ?? 'ceiling'}`}>
          <Table
            head={['Recipient', 'Level', 'Status', 'Amount', 'Sub-allocated', 'Remaining', '']}
          >
            {ordered.map(({ a, depth }) => (
              <tr key={a.id} data-testid={`allocation-${a.id}`}>
                <td className="px-2 py-1.5" style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}>
                  {a.scheme ? `${a.scheme.schemeCode} — ${a.scheme.name}` : a.recipient?.name}
                </td>
                <td className="px-2 py-1.5 text-xs">{a.level}</td>
                <td className="px-2 py-1.5">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-2 py-1.5 text-right">{inr(a.amount)}</td>
                <td className="px-2 py-1.5 text-right">
                  {a.level === 'SCHEME' ? '—' : inr(a.allocatedApproved)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {a.level === 'SCHEME' ? '—' : inr(a.remaining)}
                </td>
                <td className="px-2 py-1.5 space-x-1 whitespace-nowrap">
                  {a.status === 'DRAFT' && canAllocate && (
                    <>
                      <ApproveButton
                        path={`/budget/allocations/${a.id}/approve`}
                        version={a.version}
                        own={a.createdBy === me?.user.id}
                        onDone={refreshAll}
                      />
                      <CancelButton a={a} onDone={refreshAll} />
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          {ceiling.status === 'APPROVED' && canAllocate && (
            <AllocationForm
              ceiling={ceiling}
              allocations={allocations}
              jurisdictions={jurisdictions}
              schemes={schemes}
              onDone={refreshAll}
            />
          )}
          {ceiling.status !== 'APPROVED' && (
            <p className="mt-2 text-sm text-slate-500">Approve the ceiling before allocating.</p>
          )}
        </Card>
      )}

      {can('budget.revise') && ceiling && (
        <RevisionsCard
          ceiling={ceiling}
          allocations={allocations}
          revisions={revisions}
          meId={me?.user.id}
          onDone={refreshAll}
        />
      )}

      {can('scheme.view') && <FundingRequestsCard schemes={schemes} />}
    </>
  );
}

function orderTree(all: Allocation[]) {
  const out: { a: Allocation; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) =>
    all
      .filter((a) => a.parentAllocationId === parent)
      .forEach((a) => {
        out.push({ a, depth });
        walk(a.id, depth + 1);
      });
  walk(null, 0);
  return out;
}

function ApproveButton({
  path,
  version,
  own,
  onDone,
}: {
  path: string;
  version: number;
  own: boolean;
  onDone: () => void;
}) {
  const w = useWrite(onDone);
  return (
    <span className="inline-flex flex-col">
      <Button
        disabled={w.busy}
        title={own ? 'You created this; another officer must approve it.' : undefined}
        onClick={() => void w.run(path, { version })}
      >
        Approve
      </Button>
      <ErrorBox error={w.error} />
    </span>
  );
}

function CancelButton({ a, onDone }: { a: Allocation; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        variant="secondary"
        onClick={() => {
          const reason = window.prompt('Reason for cancelling this draft allocation?');
          if (!reason) return;
          api(`/budget/allocations/${a.id}/cancel`, {
            method: 'POST',
            body: { version: a.version, reason },
          })
            .then(onDone)
            .catch((e) => setError(errorText(e)));
        }}
      >
        Cancel
      </Button>
      <ErrorBox error={error} />
    </span>
  );
}

function CeilingForm({
  fy,
  jurisdictions,
  onDone,
}: {
  fy: string;
  jurisdictions: Jurisdiction[];
  onDone: () => void;
}) {
  const w = useWrite(onDone);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void w
      .run('/budget/ceilings', {
        financialYearId: fy,
        jurisdictionId: f.get('jurisdictionId'),
        totalAmount: f.get('totalAmount'),
      })
      .then((ok) => ok && form.reset());
  };
  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
      aria-label="Register ceiling"
    >
      <Field label="Ceiling jurisdiction">
        <Select name="jurisdictionId" required>
          {jurisdictions
            .filter((j) => !j.parentId)
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Ceiling amount (INR)">
        <Input name="totalAmount" required pattern={MONEY} inputMode="decimal" />
      </Field>
      <Button type="submit" disabled={w.busy || !fy}>
        Register ceiling
      </Button>
      <ErrorBox error={w.error} />
    </form>
  );
}

function AllocationForm(props: {
  ceiling: Ceiling;
  allocations: Allocation[];
  jurisdictions: Jurisdiction[];
  schemes: Scheme[];
  onDone: () => void;
}) {
  const { ceiling, allocations, jurisdictions, schemes } = props;
  const w = useWrite(props.onDone);
  const [parent, setParent] = useState('');
  const parentAlloc = allocations.find((a) => a.id === parent);
  const parentJid = parentAlloc?.recipientJurisdictionId ?? ceiling.jurisdictionId;
  const recipients = jurisdictions.filter(
    (j) => j.parentId === parentJid || (parentAlloc && j.id === parentJid),
  );
  const eligibleSchemes = schemes.filter(
    (s) => s.jurisdiction.id === parentJid && ['APPROVED', 'ACTIVE'].includes(s.status),
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const schemeId = (f.get('schemeId') as string) || undefined;
    const form = e.currentTarget;
    void w
      .run('/budget/allocations', {
        budgetVersionId: ceiling.id,
        parentAllocationId: parent || undefined,
        recipientJurisdictionId: schemeId ? parentJid : f.get('recipientJurisdictionId'),
        schemeId,
        amount: f.get('amount'),
      })
      .then((ok) => ok && form.reset());
  };
  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
      aria-label="New allocation"
    >
      <Field label="Allocate from">
        <Select
          aria-label="Allocate from"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">Ceiling ({inr(ceiling.available)} available)</option>
          {allocations
            .filter((a) => a.status === 'APPROVED' && a.level !== 'SCHEME')
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.recipient?.name} ({inr(a.available)} available)
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Recipient jurisdiction">
        <Select name="recipientJurisdictionId" aria-label="Recipient jurisdiction">
          {recipients.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </Select>
      </Field>
      {parentAlloc && (
        <Field label="Scheme (leaf allocation)">
          <Select name="schemeId" aria-label="Scheme">
            <option value="">— none (sub-jurisdiction) —</option>
            {eligibleSchemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.schemeCode} — {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Amount (INR)">
        <Input name="amount" aria-label="Amount" required pattern={MONEY} inputMode="decimal" />
      </Field>
      <Button type="submit" disabled={w.busy}>
        Create draft allocation
      </Button>
      <ErrorBox error={w.error} />
    </form>
  );
}

function RevisionsCard({
  ceiling,
  allocations,
  revisions,
  meId,
  onDone,
}: {
  ceiling: Ceiling;
  allocations: Allocation[];
  revisions: Revision[];
  meId?: string;
  onDone: () => void;
}) {
  const w = useWrite(onDone);
  const ids = new Set([ceiling.id, ...allocations.map((a) => a.id)]);
  const mine = revisions.filter((r) => ids.has(r.budgetVersionId ?? r.allocationId ?? ''));
  const label = (r: Revision) =>
    r.budgetVersionId
      ? 'Ceiling'
      : (allocations.find((a) => a.id === r.allocationId)?.recipient?.name ?? 'Allocation');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const target = f.get('target') as string;
    const form = e.currentTarget;
    void w
      .run('/budget/revisions', {
        targetType: target === ceiling.id ? 'BUDGET_VERSION' : 'ALLOCATION',
        targetId: target,
        requestedAmount: f.get('requestedAmount'),
        reason: f.get('reason'),
      })
      .then((ok) => ok && form.reset());
  };
  return (
    <Card title="Revision requests">
      <Table head={['Target', 'From', 'To', 'Reason', 'Status', '']}>
        {mine.map((r) => (
          <tr key={r.id}>
            <td className="px-2 py-1.5">{label(r)}</td>
            <td className="px-2 py-1.5 text-right">{inr(r.previousAmount)}</td>
            <td className="px-2 py-1.5 text-right">{inr(r.requestedAmount)}</td>
            <td className="px-2 py-1.5">{r.reason}</td>
            <td className="px-2 py-1.5">
              <StatusPill status={r.status} />
            </td>
            <td className="px-2 py-1.5 space-x-1">
              {r.status === 'PENDING' && (
                <>
                  <Button
                    disabled={w.busy}
                    title={
                      r.requestedBy === meId
                        ? 'Another officer must decide your request.'
                        : undefined
                    }
                    onClick={() =>
                      void w.run(`/budget/revisions/${r.id}/decision`, { decision: 'APPROVE' })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={w.busy}
                    onClick={() =>
                      void w.run(`/budget/revisions/${r.id}/decision`, { decision: 'REJECT' })
                    }
                  >
                    Reject
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <form
        onSubmit={submit}
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        aria-label="Request revision"
      >
        <Field label="Revise">
          <Select name="target">
            {ceiling.status === 'APPROVED' && (
              <option value={ceiling.id}>Ceiling ({inr(ceiling.totalAmount)})</option>
            )}
            {allocations
              .filter((a) => a.status === 'APPROVED')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.scheme?.schemeCode ?? a.recipient?.name} ({inr(a.amount)})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="New amount (INR)">
          <Input name="requestedAmount" required pattern={MONEY} />
        </Field>
        <Field label="Reason">
          <Input name="reason" required minLength={3} />
        </Field>
        <Button type="submit" disabled={w.busy}>
          Request revision
        </Button>
      </form>
      <ErrorBox error={w.error} />
    </Card>
  );
}

function FundingRequestsCard({ schemes }: { schemes: Scheme[] }) {
  const { can, me } = useAuth();
  const [rows, setRows] = useState<FundingRequest[]>([]);
  const [periods, setPeriods] = useState<{ id: string; code: string; financialYearId: string }[]>(
    [],
  );
  const [schemeId, setSchemeId] = useState('');
  const selected = schemes.find((s) => s.id === schemeId) ?? schemes[0];
  const yearPeriods = periods.filter((p) => p.financialYearId === selected?.financialYear.id);
  const load = useCallback(() => {
    api<FundingRequest[]>('/budget/requests')
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  useEffect(() => {
    load();
    if (can('budget.request.create', 'budget.allocate'))
      api<{ id: string; code: string; financialYearId: string }[]>('/budget/periods')
        .then(setPeriods)
        .catch(() => setPeriods([]));
  }, [load, can]);
  const w = useWrite(load);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const form = e.currentTarget;
    void w.run('/budget/requests', f).then((ok) => ok && form.reset());
  };
  return (
    <Card title="Bottom-up funding requests">
      <p className="mb-2 text-xs text-slate-500">
        Requests are separate from allocations: approving one does not move money.
      </p>
      <Table head={['Scheme', 'Period', 'Amount', 'Justification', 'Status', '']}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-2 py-1.5">{r.scheme.schemeCode}</td>
            <td className="px-2 py-1.5">{r.period.code}</td>
            <td className="px-2 py-1.5 text-right">{inr(r.amount)}</td>
            <td className="px-2 py-1.5">{r.justification}</td>
            <td className="px-2 py-1.5">
              <StatusPill status={r.status} />
            </td>
            <td className="px-2 py-1.5 space-x-1">
              {r.status === 'SUBMITTED' && can('budget.request.review') && (
                <>
                  <Button
                    disabled={w.busy}
                    title={
                      r.submittedById === me?.user.id
                        ? 'Another officer must review your request.'
                        : undefined
                    }
                    onClick={() =>
                      void w.run(`/budget/requests/${r.id}/review`, {
                        version: r.version,
                        decision: 'APPROVED',
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={w.busy}
                    onClick={() =>
                      void w.run(`/budget/requests/${r.id}/review`, {
                        version: r.version,
                        decision: 'RETURNED',
                      })
                    }
                  >
                    Return
                  </Button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {can('budget.request.create') && (
        <form
          onSubmit={submit}
          className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
          aria-label="New funding request"
        >
          <Field label="Scheme">
            <Select
              name="schemeId"
              required
              value={selected?.id ?? ''}
              onChange={(e) => setSchemeId(e.target.value)}
            >
              {schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.schemeCode} — {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Select name="periodId" required>
              {yearPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (INR)">
            <Input name="amount" required pattern={MONEY} />
          </Field>
          <Field label="Justification">
            <Input name="justification" required minLength={10} />
          </Field>
          <Button type="submit" disabled={w.busy}>
            Submit request
          </Button>
        </form>
      )}
      <ErrorBox error={w.error} />
    </Card>
  );
}
