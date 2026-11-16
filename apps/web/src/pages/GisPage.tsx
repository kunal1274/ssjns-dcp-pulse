import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Card, Field, Select, StatusPill, Table } from '../components/ui';
import type { FinancialYear, Jurisdiction } from '../lib/types';
import { useApi } from '../lib/useApi';
import { LoadState, pct } from './DashboardPages';
import { SeverityPill } from './AlertPages';

interface Props {
  id: string;
  schemeCode: string;
  name: string;
  category: string;
  status: string;
  jurisdiction: string;
  district: string | null;
  physicalCompletionPercent: string | null;
  financialUtilisationPercent: string | null;
  openAlerts: number | null;
  topAlertSeverity: string | null;
  locationAccuracy: string | null;
  coordinateIssue: string | null;
}
interface Fc {
  notice: string;
  crs: string;
  bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Props;
  }[];
  unmapped: Props[];
}

const COLORS: Record<string, string> = {
  CRITICAL: '#7f1d1d',
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#64748b',
};
const FILTERS = ['jurisdictionId', 'financialYearId', 'category'] as const;

export function GisPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const q = new URLSearchParams();
  for (const k of FILTERS) if (params.get(k)) q.set(k, params.get(k)!);
  const { data, error, denied, loading } = useApi<Fc>(`/gis/schemes?${q.toString()}`);
  const { data: jurisdictions } = useApi<Jurisdiction[]>('/jurisdictions');
  const { data: years } = useApi<FinancialYear[]>('/budget/financial-years');
  const { data: opts } = useApi<{ categories: string[] }>(
    can('report.view') ? '/dashboards/filter-options' : null,
  );
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const detail = (id: string) =>
    can('report.view') ? `/dashboards/scheme/${id}` : `/schemes/${id}`;

  useEffect(() => {
    if (!box.current || map.current) return;
    try {
      // No external tile server: background only, so the demo works offline and in CI.
      map.current = new maplibregl.Map({
        container: box.current,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef2f7' } }],
        },
        center: [92.9, 26.2],
        zoom: 6,
        attributionControl: false,
      });
      map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    } catch (e) {
      setMapError(
        `Map could not start (${(e as Error).message}); the table below lists every scheme.`,
      );
    }
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;
    const draw = () => {
      const geo = { type: 'FeatureCollection' as const, features: data.features };
      const src = m.getSource('schemes') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geo);
      else {
        m.addSource('schemes', { type: 'geojson', data: geo });
        m.addLayer({
          id: 'schemes',
          type: 'circle',
          source: 'schemes',
          paint: {
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-color': [
              'case',
              ['==', ['coalesce', ['get', 'openAlerts'], -1], -1],
              '#94a3b8',
              [
                'match',
                ['coalesce', ['get', 'topAlertSeverity'], 'NONE'],
                'CRITICAL',
                COLORS.CRITICAL,
                'HIGH',
                COLORS.HIGH,
                'MEDIUM',
                COLORS.MEDIUM,
                'LOW',
                COLORS.LOW,
                '#2563eb',
              ],
            ],
          },
        });
        m.addLayer({
          id: 'labels',
          type: 'symbol',
          source: 'schemes',
          layout: { 'text-field': ['get', 'schemeCode'], 'text-size': 11, 'text-offset': [0, 1.3] },
        });
        m.on('click', 'schemes', (e) => {
          const p = e.features?.[0]?.properties as Props | undefined;
          if (p) navigate(detail(p.id));
        });
        m.on('mouseenter', 'schemes', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'schemes', () => (m.getCanvas().style.cursor = ''));
      }
      if (data.features.length) {
        const b = new maplibregl.LngLatBounds();
        for (const f of data.features) b.extend(f.geometry.coordinates);
        m.fitBounds(b, { padding: 60, maxZoom: 9, duration: 0 });
      }
    };
    if (m.isStyleLoaded()) draw();
    else m.once('load', draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };
  const rows = data ? [...data.features.map((f) => f.properties), ...data.unmapped] : [];
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Scheme monitoring map</h1>
      <p
        className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm"
        role="note"
        data-testid="gis-notice"
      >
        {data?.notice ?? 'All locations are synthetic and approximate.'} Coordinates:{' '}
        {data?.crs ?? 'WGS84'}. No base map tiles are loaded.
      </p>
      <div className="mb-3 flex flex-wrap gap-3">
        <Field label="Jurisdiction">
          <Select
            aria-label="Jurisdiction"
            value={params.get('jurisdictionId') ?? ''}
            onChange={(e) => set('jurisdictionId', e.target.value)}
          >
            <option value="">All in my scope</option>
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
            value={params.get('financialYearId') ?? ''}
            onChange={(e) => set('financialYearId', e.target.value)}
          >
            <option value="">Any</option>
            {years?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Scheme type">
          <Select
            aria-label="Scheme type"
            value={params.get('category') ?? ''}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">Any</option>
            {opts?.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <LoadState loading={loading && !data} error={error} denied={denied} />
      {mapError && (
        <p className="mb-2 text-sm text-amber-800" role="alert">
          {mapError}
        </p>
      )}
      <div
        ref={box}
        className="mb-2 h-[460px] w-full rounded border border-slate-300"
        data-testid="gis-map"
        aria-label="Synthetic scheme locations map"
        role="region"
      />
      <div className="mb-4 flex flex-wrap gap-3 text-xs" aria-label="Legend">
        {[...Object.entries(COLORS), ['No open alert', '#2563eb']].map(([k, c]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} /> {k}
          </span>
        ))}
      </div>
      {data && (
        <Card
          title={`${data.features.length} mapped, ${data.unmapped.length} without usable coordinates`}
        >
          <Table
            head={[
              'Scheme',
              'District / location',
              'Type',
              'Status',
              'Physical',
              'Financial util.',
              'Alerts',
              'Location',
            ]}
          >
            {rows.map((p) => (
              <tr key={p.id} data-testid="gis-row">
                <td className="px-2 py-2">
                  <Link className="text-blue-700 underline" to={detail(p.id)}>
                    {p.schemeCode}
                  </Link>{' '}
                  {p.name}
                </td>
                <td className="px-2 py-2">
                  {p.district ?? '—'} / {p.jurisdiction}
                </td>
                <td className="px-2 py-2">{p.category}</td>
                <td className="px-2 py-2">
                  <StatusPill status={p.status} />
                </td>
                <td className="px-2 py-2">{pct(p.physicalCompletionPercent)}</td>
                <td className="px-2 py-2">{pct(p.financialUtilisationPercent)}</td>
                <td className="px-2 py-2">
                  {p.openAlerts === null ? (
                    <span
                      className="text-slate-500"
                      title="Needs alert-view access for this scheme"
                    >
                      Restricted
                    </span>
                  ) : p.openAlerts > 0 && p.topAlertSeverity ? (
                    <>
                      <SeverityPill severity={p.topAlertSeverity} /> ×{p.openAlerts}
                    </>
                  ) : (
                    'None'
                  )}
                </td>
                <td className="px-2 py-2 text-xs">
                  {p.coordinateIssue ? (
                    <span className="text-amber-800">
                      {p.coordinateIssue.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  ) : (
                    'Synthetic, approximate'
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
