import type { INestApplication } from '@nestjs/common';
import { ownerClient } from '../integration/db';
import { createApp, login, type Session } from './helpers';

describe('scheme milestones and synthetic location (e2e, real database)', () => {
  let app: INestApplication;
  let planner: Session, district: Session, monitor: Session;
  let schemeId = '';
  const get = (s: Session, url: string) => s.agent.get(`/api/v1${url}`);
  const send = (s: Session, method: 'post' | 'put', url: string, body: object) =>
    s.agent[method](`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);

  beforeAll(async () => {
    ({ app } = await createApp());
    planner = await login(app, 'state.planner@example.test');
    district = await login(app, 'district.reviewer@example.test');
    monitor = await login(app, 'state.monitor@example.test');
    const fy = (await get(planner, '/budget/financial-years')).body.find(
      (f: { code: string }) => f.code === '2026-27',
    );
    const js = (await get(planner, '/jurisdictions')).body as { id: string; code: string }[];
    const ag = (await get(planner, '/agencies')).body as { id: string; code: string }[];
    const code = `MS-${Date.now().toString(36).toUpperCase()}`;
    const s = await send(planner, 'post', '/schemes', {
      schemeCode: code,
      name: 'Milestone and location test scheme (synthetic)',
      category: 'ROADS',
      financialYearId: fy.id,
      agencyId: ag.find((a) => a.code === 'AG-ROADS')!.id,
      jurisdictionId: js.find((j) => j.code === 'CD-A1')!.id,
      proposedBudget: '100000.00',
    }).expect(201);
    schemeId = s.body.id;
  });
  afterAll(() => app.close());

  it('adds weighted milestones up to a total of 100 and refuses more', async () => {
    const m = {
      name: 'Formation 0–6 km',
      targetDate: '2027-01-31',
      targetQuantity: '6.000',
      unit: 'km',
      weight: '60.00',
    };
    const a = await send(planner, 'post', `/schemes/${schemeId}/milestones`, m).expect(201);
    expect(a.body).toMatchObject({
      weight: '60.00',
      targetQuantity: '6.000',
      status: 'NOT_STARTED',
    });
    const over = await send(planner, 'post', `/schemes/${schemeId}/milestones`, {
      ...m,
      name: 'Too much',
      weight: '41.00',
    }).expect(409);
    expect(over.body.error).toBe('WEIGHT_EXCEEDED');
    await send(planner, 'post', `/schemes/${schemeId}/milestones`, {
      ...m,
      name: 'Surfacing',
      weight: '40.00',
    }).expect(201);
    await send(planner, 'post', `/schemes/${schemeId}/milestones`, { ...m, weight: '0' }).expect(
      400,
    );
    await send(district, 'post', `/schemes/${schemeId}/milestones`, {
      ...m,
      weight: '1.00',
    }).expect(403);
  });

  it('validates coordinates against WGS84 and the synthetic Assam bounds before storing them', async () => {
    const outside = await send(planner, 'put', `/schemes/${schemeId}/location`, {
      latitude: 19.07,
      longitude: 72.87,
      locationAccuracy: 'SYNTHETIC_APPROXIMATE',
    }).expect(400);
    expect(outside.body.error).toBe('INVALID_COORDINATES');
    await send(planner, 'put', `/schemes/${schemeId}/location`, {
      latitude: 120,
      longitude: 91,
      locationAccuracy: 'SYNTHETIC_APPROXIMATE',
    }).expect(400);
    const ok = await send(planner, 'put', `/schemes/${schemeId}/location`, {
      latitude: 26.2,
      longitude: 91.75,
      locationAccuracy: 'SYNTHETIC_APPROXIMATE',
    }).expect(200);
    expect(ok.body).toMatchObject({ crs: 'EPSG:4326' });
    // Moving it replaces the single point rather than adding another.
    await send(planner, 'put', `/schemes/${schemeId}/location`, {
      latitude: 26.3,
      longitude: 91.8,
      locationAccuracy: 'SYNTHETIC_SURVEYED',
    }).expect(200);
    await send(district, 'put', `/schemes/${schemeId}/location`, {
      latitude: 26.3,
      longitude: 91.8,
      locationAccuracy: 'SYNTHETIC_SURVEYED',
    }).expect(403);
    // Draft schemes are not monitored on the map yet, so check the stored point directly.
    const db = await ownerClient();
    const rows = (
      await db.query(
        `SELECT ST_X(geometry::geometry) AS lon, ST_Y(geometry::geometry) AS lat, location_accuracy FROM scheme_locations WHERE scheme_id = $1`,
        [schemeId],
      )
    ).rows;
    await db.end();
    expect(rows).toEqual([{ lon: 91.8, lat: 26.3, location_accuracy: 'SYNTHETIC_SURVEYED' }]);
    await get(monitor, `/gis/schemes/${schemeId}`).expect(404);
  });
});
