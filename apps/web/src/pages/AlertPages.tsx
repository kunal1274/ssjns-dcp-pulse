import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Select, StatusPill, Table } from '../components/ui';
import { api, errorText } from '../lib/http';
import { useApi } from '../lib/useApi';
import { LoadState } from './DashboardPages';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const RULES = [
  'REPORT_OVERDUE',
  'MILESTONE_LATE',
  'PHYSICAL_FINANCIAL_GAP',
  'RELEASE_EXCEEDED',
  'ALLOCATION_EXCEEDED',
  'APPROVAL_AGED',
  'EVIDENCE_MISSING',
  'DATA_STALE',
];
const CA_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_VERIFICATION',
  'CLOSED',
  'REOPENED',
];

interface UserRef {
  id: string;
  name: string;
  email: string;
}
interface Alert {
  id: string;
  ruleCode: string;
  severity: string;
  status: string;
  dedupKey: string;
  reviewIndicator: boolean;
  escalationLevel: number;
  detectedAt: string;
  dueAt: string | null;
  lastEvaluatedAt: string | null;
  resolutionReason: string | null;
  contextJson: Record<string, unknown>;
  version: number;
  scheme: { id: string; schemeCode: string; name: string; jurisdiction: { name: string } } | null;
  assignee: UserRef | null;
}
interface AlertList {
  total: number;
  summary: { activeBySeverity: Record<string, number>; byStatus: Record<string, number> };
  items: Alert[];
}
interface HistoryEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}
interface CorrectiveAction {
  id: string;
  actionText: string;
  status: string;
  priority: string;
  dueAt: string | null;
  evidenceNote: string | null;
  closureReason: string | null;
  overdue?: boolean;
  version: number;
  owner: UserRef;
  scheme: { id: string; schemeCode: string; name: string } | null;
  alert: { id: string; ruleCode: string; severity: string; status: string } | null;
}
interface AlertDetail extends Alert {
  events: HistoryEvent[];
  correctiveActions: CorrectiveAction[];
  allowed: Record<
    'acknowledge' | 'assign' | 'resolve' | 'reopen' | 'createCorrectiveAction',
    boolean
  >;
}
interface Rule {
  id: string;
  ruleCode: string;
  scopeType: string;
  scopeId: string | null;
  severity: string;
  thresholdJson: Record<string, unknown>;
  enabled: boolean;
  evaluationFrequency: string;
  ownerRoleCode: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  lastEvaluatedAt: string | null;
  isIllustrative: boolean;
  version: number;
}

const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : '—');
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-IN') : '—');

export const SeverityPill = ({ severity }: { severity: string }) => {
  const c: Record<string, string> = {
    CRITICAL: 'bg-red-700 text-white',
    HIGH: 'bg-red-100 text-red-800',
    MEDIUM: 'bg-amber-100 text-amber-800',
    LOW: 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${c[severity] ?? ''}`}>
      {severity}
    </span>
  );
};

const Indicator = ({ review }: { review: boolean }) =>
  review ? (
    <span className="text-xs text-slate-600" title="Needs review; not evidence of misuse">
      Review indicator
    </span>
  ) : (
    <span
      className="text-xs font-medium text-red-800"
      title="A financial control limit was crossed"
    >
      Control breach
    </span>
  );

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function History({ events }: { events: HistoryEvent[] }) {
  return (
    <ol className="space-y-2 text-sm" data-testid="history">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 border-slate-300 pl-3">
          <span className="font-medium">{e.eventType.replace(/_/g, ' ')}</span>{' '}
          {e.fromStatus || e.toStatus ? (
            <span className="text-slate-500">
              {e.fromStatus ?? '—'} → {e.toStatus ?? '—'}
            </span>
          ) : null}
          <div className="text-xs text-slate-500">
            {when(e.createdAt)} · {e.actorName ?? 'System'}
          </div>
          {e.note && <div className="text-slate-700">{e.note}</div>}
        </li>
      ))}
    </ol>
  );
}

function Filters({ fields }: { fields: [string, string, string[]][] }) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="mb-3 flex flex-wrap gap-3">
      {fields.map(([key, label, options]) => (
        <Field key={key} label={label}>
          <Select
            aria-label={label}
            value={params.get(key) ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set(key, e.target.value);
              else next.delete(key);
              setParams(next);
            }}
          >
            <option value="">Any</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ alerts

export function AlertsPage() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const q = new URLSearchParams(params);
  q.set('pageSize', '100');
  const { data, error, denied, loading, reload } = useApi<AlertList>(`/alerts?${q.toString()}`);
  const ev = useAction(reload);
  const [summary, setSummary] = useState<string | null>(null);
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Alert monitoring</h1>
      <p className="mb-4 text-sm text-slate-600">
        Alerts flag records for review. A review indicator is not evidence of misuse; only release
        and allocation control breaches mean a recorded limit was crossed.
      </p>
      <Card
        title="Alerts"
        actions={
          can('alert.rule.manage') ? (
            <div className="flex gap-2">
              <Link className="text-sm text-blue-700 underline" to="/alerts/rules">
                Rule configuration
              </Link>
              <Button
                disabled={ev.busy}
                onClick={() =>
                  ev.run(async () => {
                    const r = await api<{
                      created: number;
                      reopened: number;
                      autoResolved: number;
                    }>('/alert-rules/evaluate', { method: 'POST' });
                    setSummary(
                      `Evaluated: ${r.created} new, ${r.reopened} reopened, ${r.autoResolved} auto-resolved`,
                    );
                  })
                }
              >
                Evaluate now
              </Button>
            </div>
          ) : null
        }
      >
        {summary && (
          <p className="mb-2 text-sm text-green-800" role="status">
            {summary}
          </p>
        )}
        <ErrorBox error={ev.error} />
        <Filters
          fields={[
            ['status', 'Status', ALERT_STATUSES],
            ['severity', 'Severity', SEVERITIES],
            ['ruleCode', 'Rule', RULES],
          ]}
        />
        <LoadState loading={loading && !data} error={error} denied={denied} />
        {data && (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-4" data-testid="alert-summary">
              {SEVERITIES.map((s) => (
                <div key={s} className="rounded border border-slate-200 p-2">
                  <div className="text-xs text-slate-500">Active {s.toLowerCase()}</div>
                  <div className="text-xl font-semibold">
                    {data.summary.activeBySeverity[s] ?? 0}
                  </div>
                </div>
              ))}
            </div>
            <Table
              head={['Rule', 'Scheme', 'Severity', 'Status', 'Type', 'Assignee', 'Detected', 'Due']}
            >
              {data.items.map((a) => (
                <tr key={a.id} data-testid="alert-row">
                  <td className="px-2 py-2">
                    <Link className="text-blue-700 underline" to={`/alerts/${a.id}`}>
                      {a.ruleCode.replace(/_/g, ' ')}
                    </Link>
                    {a.escalationLevel > 0 && (
                      <span className="ml-1 text-xs text-red-700">
                        Escalated L{a.escalationLevel}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {a.scheme ? `${a.scheme.schemeCode} · ${a.scheme.jurisdiction.name}` : 'Tenant'}
                  </td>
                  <td className="px-2 py-2">
                    <SeverityPill severity={a.severity} />
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-2 py-2">
                    <Indicator review={a.reviewIndicator} />
                  </td>
                  <td className="px-2 py-2">{a.assignee?.name ?? '—'}</td>
                  <td className="px-2 py-2">{day(a.detectedAt)}</td>
                  <td className="px-2 py-2">{day(a.dueAt)}</td>
                </tr>
              ))}
            </Table>
            {data.items.length === 0 && (
              <p className="text-sm text-slate-600">No alerts match these filters.</p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Inline({
  label,
  children,
  onSubmit,
  busy,
}: {
  label: string;
  children: ReactNode;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <Button type="submit" variant="secondary" disabled={busy}>
        {label}
      </Button>
    </form>
  );
}

export function AlertDetailPage() {
  const { id } = useParams();
  const { data: a, error, denied, loading, reload } = useApi<AlertDetail>(`/alerts/${id}`);
  const { data: people } = useApi<UserRef[]>(a?.allowed.assign ? `/alerts/${id}/assignees` : null);
  const act = useAction(reload);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');
  const [ca, setCa] = useState({ ownerId: '', actionText: '', dueAt: '', priority: 'MEDIUM' });
  const post = (path: string, body: object) =>
    act.run(() =>
      api(`/alerts/${id}${path}`, { method: 'POST', body: { version: a!.version, ...body } }),
    );
  return (
    <div>
      <Link to="/alerts" className="text-sm text-blue-700 underline">
        ← Alerts
      </Link>
      <LoadState loading={loading && !a} error={error} denied={denied} />
      {a && (
        <>
          <h1 className="my-2 text-2xl font-semibold" data-testid="alert-title">
            {a.ruleCode.replace(/_/g, ' ')} {a.scheme ? `· ${a.scheme.schemeCode}` : ''}
          </h1>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SeverityPill severity={a.severity} />
            <StatusPill status={a.status} />
            <Indicator review={a.reviewIndicator} />
            {a.escalationLevel > 0 && (
              <span className="text-xs text-red-700">Escalation level {a.escalationLevel}</span>
            )}
          </div>
          <Card title="Details">
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-slate-500">Scheme</dt>
              <dd>
                {a.scheme ? (
                  <Link className="text-blue-700 underline" to={`/schemes/${a.scheme.id}`}>
                    {a.scheme.schemeCode} — {a.scheme.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-slate-500">Assignee</dt>
              <dd data-testid="alert-assignee">{a.assignee?.name ?? 'Unassigned'}</dd>
              <dt className="text-slate-500">Detected / response due</dt>
              <dd>
                {when(a.detectedAt)} / {when(a.dueAt)}
              </dd>
              <dt className="text-slate-500">Last evaluated</dt>
              <dd>{when(a.lastEvaluatedAt)}</dd>
              {Object.entries(a.contextJson ?? {}).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd data-testid={`ctx-${k}`}>
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
              {a.resolutionReason && (
                <>
                  <dt className="text-slate-500">Resolution</dt>
                  <dd>{a.resolutionReason}</dd>
                </>
              )}
            </dl>
          </Card>
          <Card title="Actions">
            <ErrorBox error={act.error} />
            <div className="space-y-3">
              {a.allowed.acknowledge && (
                <Inline
                  label="Acknowledge"
                  busy={act.busy}
                  onSubmit={() => post('/acknowledge', { note: note || undefined })}
                >
                  <Field label="Note (optional)">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </Inline>
              )}
              {a.allowed.assign && (
                <Inline
                  label="Assign"
                  busy={act.busy}
                  onSubmit={() => post('/assign', { assigneeId: assignee })}
                >
                  <Field label="Assignee">
                    <Select
                      aria-label="Assignee"
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                      required
                    >
                      <option value="">Select…</option>
                      {(people ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </Inline>
              )}
              {a.allowed.assign && (
                <Inline
                  label="Escalate"
                  busy={act.busy}
                  onSubmit={() => post('/escalate', { note: note || undefined })}
                >
                  <span className="text-sm text-slate-600">
                    Raise one escalation level and reset the response window.
                  </span>
                </Inline>
              )}
              {(a.allowed.resolve || a.allowed.reopen) && (
                <Inline
                  label={a.allowed.resolve ? 'Resolve' : 'Reopen'}
                  busy={act.busy}
                  onSubmit={() => post(a.allowed.resolve ? '/resolve' : '/reopen', { reason })}
                >
                  <Field label="Reason (required)">
                    <Input
                      aria-label="Reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={5}
                      required
                    />
                  </Field>
                </Inline>
              )}
            </div>
          </Card>
          <Card title="Corrective actions">
            {a.correctiveActions.length > 0 && (
              <Table head={['Action', 'Owner', 'Due', 'Status']}>
                {a.correctiveActions.map((c) => (
                  <tr key={c.id}>
                    <td className="px-2 py-2">
                      <Link className="text-blue-700 underline" to={`/corrective-actions/${c.id}`}>
                        {c.actionText}
                      </Link>
                    </td>
                    <td className="px-2 py-2">{c.owner.name}</td>
                    <td className="px-2 py-2">{day(c.dueAt)}</td>
                    <td className="px-2 py-2">
                      <StatusPill status={c.status} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            {a.allowed.createCorrectiveAction && (
              <form
                className="mt-3 grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act.run(() =>
                    api('/corrective-actions', { method: 'POST', body: { alertId: a.id, ...ca } }),
                  );
                }}
              >
                <Field label="Responsible officer">
                  <Select
                    aria-label="Responsible officer"
                    value={ca.ownerId}
                    onChange={(e) => setCa({ ...ca, ownerId: e.target.value })}
                    required
                  >
                    <option value="">Select…</option>
                    {(people ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date">
                  <Input
                    type="date"
                    aria-label="Due date"
                    value={ca.dueAt}
                    onChange={(e) => setCa({ ...ca, dueAt: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Action">
                  <Input
                    aria-label="Action"
                    value={ca.actionText}
                    minLength={5}
                    onChange={(e) => setCa({ ...ca, actionText: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Priority">
                  <Select
                    aria-label="Priority"
                    value={ca.priority}
                    onChange={(e) => setCa({ ...ca, priority: e.target.value })}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <div>
                  <Button type="submit" disabled={act.busy}>
                    Create corrective action
                  </Button>
                </div>
              </form>
            )}
          </Card>
          <Card title="History">
            <History events={a.events} />
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rules

function RuleRow({ r, canManage, onSaved }: { r: Rule; canManage: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    enabled: r.enabled,
    severity: r.severity,
    evaluationFrequency: r.evaluationFrequency,
    threshold: JSON.stringify(r.thresholdJson),
    reason: '',
  });
  const act = useAction(() => {
    setEdit(false);
    onSaved();
  });
  return (
    <tr data-testid={`rule-${r.ruleCode}-${r.scopeType}`}>
      <td className="px-2 py-2">
        <div className="font-medium">{r.ruleCode.replace(/_/g, ' ')}</div>
        <div className="text-xs text-slate-500">{r.description}</div>
      </td>
      <td className="px-2 py-2">{r.scopeType}</td>
      {!edit ? (
        <>
          <td className="px-2 py-2">
            <code className="text-xs">{JSON.stringify(r.thresholdJson)}</code>
          </td>
          <td className="px-2 py-2">
            <SeverityPill severity={r.severity} />
          </td>
          <td className="px-2 py-2">
            {r.enabled ? 'Enabled' : 'Disabled'} · {r.evaluationFrequency}
          </td>
          <td className="px-2 py-2">
            {day(r.effectiveFrom)}
            {r.effectiveTo ? ` → ${day(r.effectiveTo)}` : ''}
          </td>
          <td className="px-2 py-2">{when(r.lastEvaluatedAt)}</td>
          <td className="px-2 py-2">
            {canManage && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
          </td>
        </>
      ) : (
        <td className="px-2 py-2" colSpan={6}>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act.run(async () => {
                let threshold: unknown;
                try {
                  threshold = JSON.parse(form.threshold);
                } catch {
                  throw new Error('Threshold must be valid JSON');
                }
                await api(`/alert-rules/${r.id}`, {
                  method: 'PATCH',
                  body: {
                    version: r.version,
                    enabled: form.enabled,
                    severity: form.severity,
                    evaluationFrequency: form.evaluationFrequency,
                    threshold,
                    reason: form.reason,
                  },
                });
              });
            }}
          >
            <Field label="Threshold (JSON)">
              <Input
                aria-label="Threshold"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              />
            </Field>
            <Field label="Severity">
              <Select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                {SEVERITIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Frequency">
              <Select
                value={form.evaluationFrequency}
                onChange={(e) => setForm({ ...form, evaluationFrequency: e.target.value })}
              >
                {['HOURLY', 'DAILY', 'WEEKLY', 'ON_EVENT'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />{' '}
              Enabled
            </label>
            <Field label="Reason for change">
              <Input
                aria-label="Reason for change"
                value={form.reason}
                minLength={5}
                required
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={act.busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEdit(false)}>
              Cancel
            </Button>
            <ErrorBox error={act.error} />
          </form>
        </td>
      )}
    </tr>
  );
}

export function AlertRulesPage() {
  const { data, error, denied, loading, reload } = useApi<{ canManage: boolean; items: Rule[] }>(
    '/alert-rules',
  );
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Alert rule configuration</h1>
      <p className="mb-4 text-sm text-slate-600">
        Thresholds are illustrative values for the synthetic demonstration, not official norms. The
        most specific effective rule (scheme → agency → jurisdiction → tenant) applies; every change
        is audited.
      </p>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && (
        <Card title="Rules">
          <Table
            head={[
              'Rule',
              'Scope',
              'Threshold',
              'Severity',
              'State',
              'Effective',
              'Last evaluated',
              '',
            ]}
          >
            {data.items.map((r) => (
              <RuleRow
                key={`${r.id}-${r.version}`}
                r={r}
                canManage={data.canManage}
                onSaved={reload}
              />
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------- corrective actions

export function CorrectiveActionsPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'all';
  const q = new URLSearchParams();
  if (params.get('status')) q.set('status', params.get('status')!);
  if (view === 'mine') q.set('mine', 'true');
  if (view === 'verify') q.set('toVerify', 'true');
  q.set('pageSize', '100');
  const { data, error, denied, loading } = useApi<{ total: number; items: CorrectiveAction[] }>(
    `/corrective-actions?${q.toString()}`,
  );
  const tab = (v: string, label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      className={`rounded px-3 py-1 text-sm ${view === v ? 'bg-slate-800 text-white' : 'border border-slate-300'}`}
      onClick={() => {
        const n = new URLSearchParams(params);
        n.set('view', v);
        setParams(n);
      }}
    >
      {label}
    </button>
  );
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Corrective actions</h1>
      <div className="mb-3 flex gap-2">
        {tab('all', 'Register')}
        {tab('mine', 'Assigned to me')}
        {tab('verify', 'Awaiting my verification')}
      </div>
      <Filters fields={[['status', 'Status', CA_STATUSES]]} />
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && (
        <Card title={`${data.total} corrective action(s)`}>
          <Table head={['Action', 'Scheme', 'Alert', 'Owner', 'Priority', 'Due', 'Status']}>
            {data.items.map((c) => (
              <tr key={c.id} data-testid="ca-row">
                <td className="px-2 py-2">
                  <Link className="text-blue-700 underline" to={`/corrective-actions/${c.id}`}>
                    {c.actionText}
                  </Link>
                </td>
                <td className="px-2 py-2">{c.scheme?.schemeCode ?? '—'}</td>
                <td className="px-2 py-2">{c.alert?.ruleCode.replace(/_/g, ' ') ?? '—'}</td>
                <td className="px-2 py-2">{c.owner.name}</td>
                <td className="px-2 py-2">
                  <SeverityPill severity={c.priority} />
                </td>
                <td className={`px-2 py-2 ${c.overdue ? 'font-medium text-red-700' : ''}`}>
                  {day(c.dueAt)}
                  {c.overdue ? ' (overdue)' : ''}
                </td>
                <td className="px-2 py-2">
                  <StatusPill status={c.status} />
                </td>
              </tr>
            ))}
          </Table>
          {data.items.length === 0 && <p className="text-sm text-slate-600">Nothing here.</p>}
        </Card>
      )}
    </div>
  );
}

interface CaDetail extends CorrectiveAction {
  createdByName: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  events: HistoryEvent[];
  allowed: {
    addProgress: boolean;
    submitForVerification: boolean;
    edit: boolean;
    verify: boolean;
    verifyBlockedReason: string | null;
  };
}

export function CorrectiveActionDetailPage() {
  const { id } = useParams();
  const { data: c, error, denied, loading, reload } = useApi<CaDetail>(`/corrective-actions/${id}`);
  const act = useAction(reload);
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const send = (method: 'POST' | 'PATCH', path: string, body: object) =>
    act.run(() =>
      api(`/corrective-actions/${id}${path}`, { method, body: { version: c!.version, ...body } }),
    );
  return (
    <div>
      <Link to="/corrective-actions" className="text-sm text-blue-700 underline">
        ← Corrective actions
      </Link>
      <LoadState loading={loading && !c} error={error} denied={denied} />
      {c && (
        <>
          <h1 className="my-2 text-2xl font-semibold">{c.actionText}</h1>
          <div className="mb-4 flex items-center gap-2" data-testid="ca-status">
            <StatusPill status={c.status} />
            <SeverityPill severity={c.priority} />
          </div>
          <Card title="Details">
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-slate-500">Alert</dt>
              <dd>
                {c.alert ? (
                  <Link className="text-blue-700 underline" to={`/alerts/${c.alert.id}`}>
                    {c.alert.ruleCode.replace(/_/g, ' ')}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-slate-500">Scheme</dt>
              <dd>{c.scheme ? `${c.scheme.schemeCode} — ${c.scheme.name}` : '—'}</dd>
              <dt className="text-slate-500">Responsible officer</dt>
              <dd>{c.owner.name}</dd>
              <dt className="text-slate-500">Created by</dt>
              <dd>{c.createdByName ?? '—'}</dd>
              <dt className="text-slate-500">Due</dt>
              <dd>{day(c.dueAt)}</dd>
              <dt className="text-slate-500">Evidence</dt>
              <dd>{c.evidenceNote ?? '—'}</dd>
              {c.verifiedByName && (
                <>
                  <dt className="text-slate-500">Verified by</dt>
                  <dd>
                    {c.verifiedByName} · {when(c.verifiedAt)} · {c.closureReason}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Evidence is recorded as a reference note; file upload is not implemented in this
              build.
            </p>
          </Card>
          <Card title="Work">
            <ErrorBox error={act.error} />
            <div className="space-y-3">
              {c.allowed.addProgress && (
                <Inline
                  label="Add progress note"
                  busy={act.busy}
                  onSubmit={() => send('PATCH', '', { progressNote: note })}
                >
                  <Field label="Progress note">
                    <Input
                      aria-label="Progress note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required
                    />
                  </Field>
                </Inline>
              )}
              {c.allowed.submitForVerification && (
                <Inline
                  label="Submit for verification"
                  busy={act.busy}
                  onSubmit={() =>
                    send('POST', '/submit-for-verification', { evidenceNote: evidence })
                  }
                >
                  <Field label="Evidence reference">
                    <Input
                      aria-label="Evidence reference"
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                      required
                      minLength={3}
                    />
                  </Field>
                </Inline>
              )}
              {c.allowed.verify && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => e.preventDefault()}
                >
                  <Field label="Verification reason">
                    <Input
                      aria-label="Verification reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      minLength={5}
                      required
                    />
                  </Field>
                  <Button
                    disabled={act.busy || reason.length < 5}
                    onClick={() => send('POST', '/close', { decision: 'CLOSE', reason })}
                  >
                    Verify and close
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={act.busy || reason.length < 5}
                    onClick={() => send('POST', '/close', { decision: 'REOPEN', reason })}
                  >
                    Reopen
                  </Button>
                </form>
              )}
              {c.allowed.verifyBlockedReason && (
                <p className="text-sm text-amber-800" role="note">
                  {c.allowed.verifyBlockedReason}
                </p>
              )}
              {!c.allowed.addProgress && !c.allowed.submitForVerification && !c.allowed.verify && (
                <p className="text-sm text-slate-600">No actions available to you at this stage.</p>
              )}
            </div>
          </Card>
          <Card title="History">
            <History events={c.events} />
          </Card>
        </>
      )}
    </div>
  );
}
