import { useCallback, useEffect, useState } from 'react';
import { SYNTHETIC_DATA_DISCLAIMER, type ReadinessResponse } from '@dcp/shared';
import { fetchReadiness } from './api';

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; data: ReadinessResponse }
  | { kind: 'unreachable'; message: string };

function Badge({ up, label }: { up: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-medium ${
        up ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Engineering status page for the F01–F03 foundation. It shows only live
 * health-check results from the API; there are no business screens yet.
 */
export function StatusPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'loaded', data: await fetchReadiness(signal) });
    } catch (error) {
      if (signal?.aborted) return;
      setState({
        kind: 'unreachable',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div
        role="note"
        className="mb-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {SYNTHETIC_DATA_DISCLAIMER}
      </div>

      <h1 className="text-2xl font-semibold">DCP Pulse — system status</h1>
      <p className="mt-1 text-sm text-slate-600">
        Engineering health view. Dashboards, releases, expenditure and progress features are not
        implemented yet.
      </p>

      <section
        aria-labelledby="health-heading"
        className="mt-6 rounded border border-slate-200 bg-white p-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="health-heading" className="text-lg font-medium">
            API readiness
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
          >
            Refresh
          </button>
        </div>

        {state.kind === 'loading' && <p className="mt-3 text-sm">Checking…</p>}

        {state.kind === 'unreachable' && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            API unreachable: {state.message}
          </p>
        )}

        {state.kind === 'loaded' && (
          <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-600">Overall</dt>
            <dd>
              <Badge
                up={state.data.status === 'ok'}
                label={state.data.status === 'ok' ? 'Ready' : 'Not ready'}
              />
            </dd>
            <dt className="text-slate-600">Database / PostGIS</dt>
            <dd>
              <Badge
                up={state.data.checks.database.status === 'up'}
                label={state.data.checks.database.status}
              />
              {state.data.checks.database.postgisVersion && (
                <span className="ml-2 text-slate-600">
                  PostGIS {state.data.checks.database.postgisVersion}
                </span>
              )}
            </dd>
            <dt className="text-slate-600">Migrations</dt>
            <dd>
              <Badge
                up={state.data.checks.migrations.status === 'up'}
                label={state.data.checks.migrations.status}
              />
              {state.data.checks.migrations.applied !== undefined && (
                <span className="ml-2 text-slate-600">
                  {state.data.checks.migrations.applied} applied,{' '}
                  {state.data.checks.migrations.pending} pending
                </span>
              )}
            </dd>
            <dt className="text-slate-600">Checked at</dt>
            <dd>{new Date(state.data.timestamp).toLocaleString()}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
