import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Select, StatusPill, Table } from '../components/ui';
import { api, errorText } from '../lib/http';
import { useApi } from '../lib/useApi';
import { LoadState } from './DashboardPages';

interface Source {
  id: string;
  code: string;
  name: string;
  adapter: string;
  description: string | null;
  isSynthetic: boolean;
  enabled: boolean;
  configJson: { columns?: Record<string, string>; maxRows?: number };
}
interface Batch {
  id: string;
  source: string;
  filename: string;
  status: string;
  receivedAt: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  alreadyImportedCount: number;
  committedCount: number;
  reconciliation: Record<string, string | number> | null;
  version: number;
}
interface RowError {
  rowNumber: number;
  field?: string | null;
  code: string;
  message: string;
}
interface StagedRow {
  rowNumber: number;
  externalId: string;
  schemeCode: string;
  amount: string;
  releaseDate: string;
  reference: string;
  status: string;
}
interface PreviewResult {
  batch: Batch;
  previouslyCommittedBatch: { id: string; committedAt: string } | null;
  totals: { newRecords: number; newAmount: string };
  rows: StagedRow[];
  errors: RowError[];
}

function Errors({ errors }: { errors: RowError[] }) {
  if (!errors.length) return null;
  return (
    <Table head={['Row', 'Field', 'Code', 'Problem']}>
      {errors.map((e, i) => (
        <tr key={i} data-testid="import-error">
          <td className="px-2 py-1">{e.rowNumber}</td>
          <td className="px-2 py-1">{e.field ?? '—'}</td>
          <td className="px-2 py-1 font-mono text-xs">{e.code}</td>
          <td className="px-2 py-1">{e.message}</td>
        </tr>
      ))}
    </Table>
  );
}

function Reconciliation({ r }: { r: Record<string, string | number> }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" data-testid="reconciliation">
      {Object.entries(r).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ImportsPage() {
  const sources = useApi<Source[]>('/imports/sources');
  const batches = useApi<Batch[]>('/imports');
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<Record<string, string | number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = sources.data?.find((s) => s.id === (sourceId || sources.data?.[0]?.id));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      batches.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Synthetic data import</h1>
      <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm" role="note">
        Integration-readiness demonstration with synthetic CSV files only. No live e-Rupantor or
        other government API is connected. Imported fund releases arrive unverified and still need
        finance verification by a different person.
      </p>
      <LoadState
        loading={sources.loading && !sources.data}
        error={sources.error}
        denied={sources.denied}
      />
      {sources.data && src && (
        <Card title="1. Choose source and file">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Source">
              <Select
                aria-label="Source"
                value={src.id}
                onChange={(e) => setSourceId(e.target.value)}
              >
                {sources.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="CSV file">
              <input
                aria-label="CSV file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Button
              disabled={!file || busy}
              onClick={() =>
                run(async () => {
                  setCommitted(null);
                  const content = await file!.text();
                  setPreview(
                    await api<PreviewResult>('/imports/preview', {
                      method: 'POST',
                      body: { sourceId: src.id, filename: file!.name, content },
                    }),
                  );
                })
              }
            >
              Validate and preview
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {src.description} Expected columns:{' '}
            {Object.values(src.configJson.columns ?? {}).join(', ')}. Max {src.configJson.maxRows}{' '}
            rows.
          </p>
        </Card>
      )}
      <ErrorBox error={error} />
      {preview && (
        <Card title="2. Preview (nothing is saved until you commit)">
          <div
            className="mb-2 flex flex-wrap items-center gap-3 text-sm"
            data-testid="preview-summary"
          >
            <StatusPill status={preview.batch.status} />
            <span>{preview.batch.rowCount} rows</span>
            <span>{preview.batch.validCount} valid</span>
            <span>{preview.batch.errorCount} errors</span>
            <span>{preview.batch.duplicateCount} duplicates in file</span>
            <span>{preview.batch.alreadyImportedCount} already imported</span>
            <span>
              New: {preview.totals.newRecords} release(s), ₹
              {Number(preview.totals.newAmount).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>
          {preview.previouslyCommittedBatch && (
            <p className="mb-2 text-sm text-amber-800" role="status">
              This exact file was committed before; already-imported rows will be skipped.
            </p>
          )}
          <Errors errors={preview.errors} />
          {preview.rows.length > 0 && (
            <Table
              head={[
                'Row',
                'External ID',
                'Scheme',
                'Amount (INR)',
                'Release date',
                'Reference',
                'Result',
              ]}
            >
              {preview.rows.map((r) => (
                <tr key={r.rowNumber} data-testid="preview-row">
                  <td className="px-2 py-1">{r.rowNumber}</td>
                  <td className="px-2 py-1">{r.externalId}</td>
                  <td className="px-2 py-1">{r.schemeCode}</td>
                  <td className="px-2 py-1 text-right">{r.amount}</td>
                  <td className="px-2 py-1">{r.releaseDate}</td>
                  <td className="px-2 py-1">{r.reference}</td>
                  <td className="px-2 py-1">
                    {r.status === 'NEW' ? 'Will be created' : 'Already imported (skip)'}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {preview.batch.status === 'VALIDATED' && !committed && (
            <Button
              className="mt-3"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ reconciliation: Record<string, string | number> }>(
                    `/imports/${preview.batch.id}/commit`,
                    {
                      method: 'POST',
                      body: { version: preview.batch.version },
                    },
                  );
                  setCommitted(r.reconciliation);
                })
              }
            >
              Commit import
            </Button>
          )}
          {preview.batch.status === 'FAILED' && (
            <p className="mt-2 text-sm text-red-800">
              Fix the errors and upload the file again; nothing was imported.
            </p>
          )}
        </Card>
      )}
      {committed && (
        <Card title="3. Reconciliation">
          <Reconciliation r={committed} />
        </Card>
      )}
      <Card title="Import history">
        <LoadState
          loading={batches.loading && !batches.data}
          error={batches.error}
          denied={batches.denied}
        />
        {batches.data && (
          <Table head={['Received', 'File', 'Status', 'Rows', 'Errors', 'Created', 'Skipped']}>
            {batches.data.map((b) => (
              <tr key={b.id} data-testid="batch-row">
                <td className="px-2 py-1">{new Date(b.receivedAt).toLocaleString('en-IN')}</td>
                <td className="px-2 py-1">
                  <Link className="text-blue-700 underline" to={`/imports/${b.id}`}>
                    {b.filename}
                  </Link>
                </td>
                <td className="px-2 py-1">
                  <StatusPill status={b.status} />
                </td>
                <td className="px-2 py-1">{b.rowCount}</td>
                <td className="px-2 py-1">{b.errorCount}</td>
                <td className="px-2 py-1">{b.committedCount}</td>
                <td className="px-2 py-1">{b.alreadyImportedCount}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export function ImportBatchPage() {
  const { id } = useParams();
  const { data, error, denied, loading } = useApi<
    Batch & { createdByName: string | null; committedByName: string | null; errors: RowError[] }
  >(`/imports/${id}`);
  return (
    <div>
      <Link to="/imports" className="text-sm text-blue-700 underline">
        ← Imports
      </Link>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {data && (
        <>
          <h1 className="my-2 text-2xl font-semibold">{data.filename}</h1>
          <Card title="Batch">
            <p className="text-sm">
              <StatusPill status={data.status} /> {data.source} · previewed by{' '}
              {data.createdByName ?? '—'}
              {data.committedByName ? ` · committed by ${data.committedByName}` : ''}
            </p>
            {data.reconciliation && <Reconciliation r={data.reconciliation} />}
          </Card>
          <Card title={`Errors (${data.errorCount})`}>
            <Errors errors={data.errors} />
          </Card>
        </>
      )}
    </div>
  );
}
