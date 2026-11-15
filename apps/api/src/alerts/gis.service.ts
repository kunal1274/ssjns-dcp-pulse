import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../auth/auth-context';
import { AuthorizationService, notFound } from '../authz/authorization.service';
import { mapDbError } from '../common/db-errors';
import { withMetrics } from '../dashboards/kpi.sql';
import { PrismaService } from '../prisma/prisma.service';
import type { GisQuery } from './dto';

/** Approximate synthetic-demo bounding box for Assam (WGS84); points outside are flagged, not hidden. */
export const DEMO_BOUNDS = { minLon: 89.6, maxLon: 96.1, minLat: 24.1, maxLat: 28.0 };

interface GisRow {
  id: string;
  scheme_code: string;
  name: string;
  category: string;
  status: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  district_name: string | null;
  physical: string | null;
  fin_util: string | null;
  open_alerts: number;
  top_severity: string | null;
  lon: number | null;
  lat: number | null;
  location_accuracy: string | null;
  source: string | null;
}

export function coordinateIssue(lon: number | null, lat: number | null): string | null {
  if (lon == null || lat == null) return 'MISSING';
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    lon < -180 ||
    lon > 180 ||
    lat < -90 ||
    lat > 90
  )
    return 'INVALID';
  const b = DEMO_BOUNDS;
  if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat)
    return 'OUTSIDE_DEMO_BOUNDS';
  return null;
}

@Injectable()
export class GisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  private query(
    scope: Awaited<ReturnType<AuthorizationService['requireScope']>>,
    q: GisQuery & { schemeId?: string },
  ) {
    return withMetrics(
      {
        scope,
        subtreeOf: q.jurisdictionId,
        financialYearId: q.financialYearId,
        category: q.category,
        schemeId: q.schemeId,
      },
      Prisma.sql`, loc AS (
          SELECT DISTINCT ON (l.scheme_id) l.scheme_id, ST_X(l.geometry::geometry) AS lon, ST_Y(l.geometry::geometry) AS lat,
            l.location_accuracy, l.source
          FROM scheme_locations l JOIN m ON m.id = l.scheme_id ORDER BY l.scheme_id, l.updated_at DESC),
        sev AS (
          SELECT a.scheme_id, MAX(CASE a.severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END) AS n
          FROM alerts a JOIN m ON m.id = a.scheme_id WHERE a.status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS') GROUP BY a.scheme_id)
        SELECT m.id, m.scheme_code, m.name, m.category, m.status::text AS status, m.jurisdiction_id,
          j.name AS jurisdiction_name, d.name AS district_name,
          m.physical::text, m.fin_util::text, m.open_alerts::int,
          CASE sev.n WHEN 4 THEN 'CRITICAL' WHEN 3 THEN 'HIGH' WHEN 2 THEN 'MEDIUM' WHEN 1 THEN 'LOW' END AS top_severity,
          loc.lon, loc.lat, loc.location_accuracy, loc.source
        FROM m JOIN jurisdictions j ON j.id = m.jurisdiction_id
        LEFT JOIN jurisdictions d ON d.id = (CASE WHEN cardinality(m.ancestry) >= 2 THEN m.ancestry[2] ELSE m.jurisdiction_id END)
        LEFT JOIN loc ON loc.scheme_id = m.id LEFT JOIN sev ON sev.scheme_id = m.id
        WHERE ${q.status ? Prisma.sql`m.status::text = ${q.status}` : Prisma.sql`TRUE`}
        ORDER BY m.scheme_code`,
    );
  }

  private feature(r: GisRow) {
    const issue = coordinateIssue(r.lon, r.lat);
    const props = {
      id: r.id,
      schemeCode: r.scheme_code,
      name: r.name,
      category: r.category,
      status: r.status,
      jurisdiction: r.jurisdiction_name,
      district: r.district_name,
      physicalCompletionPercent: r.physical,
      financialUtilisationPercent: r.fin_util,
      openAlerts: r.open_alerts,
      topAlertSeverity: r.top_severity,
      locationAccuracy: r.location_accuracy,
      locationSource: r.source,
      synthetic: true,
      coordinateIssue: issue,
    };
    return { issue, props, coords: [r.lon, r.lat] as [number | null, number | null] };
  }

  schemes(auth: AuthContext, q: GisQuery) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        const scope = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
        const rows = await tx.$queryRaw<GisRow[]>(this.query(scope, q));
        const features = [];
        const unmapped = [];
        for (const r of rows) {
          const f = this.feature(r);
          if (f.issue === 'MISSING' || f.issue === 'INVALID') unmapped.push(f.props);
          else
            features.push({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: f.coords },
              properties: f.props,
            });
        }
        return {
          type: 'FeatureCollection' as const,
          crs: 'EPSG:4326 (WGS84)',
          notice:
            'All locations are synthetic and approximate; they do not represent real works sites.',
          bounds: DEMO_BOUNDS,
          features,
          unmapped,
          generatedAt: new Date().toISOString(),
        };
      })
      .catch(mapDbError);
  }

  scheme(auth: AuthContext, id: string) {
    return this.prisma
      .withTenant(auth.tenantId, async (tx) => {
        const scope = await this.authz.requireScope(tx, auth.userId, 'scheme.view');
        const [row] = await tx.$queryRaw<GisRow[]>(this.query(scope, { schemeId: id }));
        if (!row) throw notFound('Scheme');
        const f = this.feature(row);
        const alerts = await tx.alert.findMany({
          where: { schemeId: id, status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
          select: { id: true, ruleCode: true, severity: true, status: true, reviewIndicator: true },
          orderBy: { detectedAt: 'desc' },
        });
        return {
          ...f.props,
          longitude: f.coords[0],
          latitude: f.coords[1],
          crs: 'EPSG:4326 (WGS84)',
          notice: 'Synthetic, approximate location for demonstration only.',
          alerts,
        };
      })
      .catch(mapDbError);
  }
}
