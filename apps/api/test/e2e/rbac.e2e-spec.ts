import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from 'pg';
import type { CapturingMailSender } from '../../src/mail/mail.service';
import { ownerClient } from '../integration/db';
import { createApp, login, tokenFrom, unique, type Session } from './helpers';

const PW = 'Synthetic-Pass-2026';

describe('F05 roles, permissions and jurisdiction security (e2e, real database)', () => {
  let app: INestApplication;
  let mail: CapturingMailSender;
  let owner: Client;
  let admin: Session;
  const ids: Record<string, string> = {};
  const roleIds: Record<string, string> = {};

  const post = (s: Session, url: string, body: object) =>
    s.agent.post(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const patch = (s: Session, url: string, body: object) =>
    s.agent.patch(`/api/v1${url}`).set('x-csrf-token', s.csrf).send(body);
  const del = (s: Session, url: string) =>
    s.agent.delete(`/api/v1${url}`).set('x-csrf-token', s.csrf).send({ reason: 'test' });

  async function newUser(): Promise<{ id: string; email: string }> {
    const email = unique('rbac');
    const res = await post(admin, '/users/invite', { email, name: 'RBAC Test User' });
    expect(res.status).toBe(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: tokenFrom(mail.sent.at(-1)!.body), newPassword: PW })
      .expect(204);
    return { id: res.body.id, email };
  }

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    owner = await ownerClient();
    admin = await login(app, 'admin@example.test');
    const j = await owner.query(
      `SELECT code, id FROM jurisdictions WHERE tenant_id = (SELECT id FROM tenants WHERE code = 'ASSAM-DEMO')`,
    );
    j.rows.forEach((r) => (ids[r.code] = r.id));
    const roles = await admin.agent.get('/api/v1/roles');
    roles.body.forEach((r: { code: string; id: string }) => (roleIds[r.code] = r.id));
    const u = await owner.query(`SELECT id FROM users WHERE email = 'admin@example.test'`);
    ids.admin = u.rows[0].id;
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  it('serves the permission catalogue and roles from the database to authorised users only', async () => {
    const perms = await admin.agent.get('/api/v1/permissions');
    expect(perms.status).toBe(200);
    expect(perms.body.map((p: { code: string }) => p.code)).toEqual(
      expect.arrayContaining(['scheme.create', 'budget.allocate', 'role.manage']),
    );
    expect(Object.keys(roleIds)).toEqual(
      expect.arrayContaining(['SYSTEM_ADMIN', 'AUDITOR', 'DISTRICT_REVIEWER']),
    );
    const officer = await login(app, 'field.officer@example.test');
    expect((await officer.agent.get('/api/v1/permissions')).status).toBe(403);
    expect((await officer.agent.get('/api/v1/users')).status).toBe(403);
  });

  it('a normal user cannot grant admin privileges (to anyone, including themselves)', async () => {
    const reviewer = await login(app, 'district.reviewer@example.test');
    const me = await owner.query(
      `SELECT id FROM users WHERE email = 'district.reviewer@example.test'`,
    );
    const res = await post(reviewer, `/users/${me.rows[0].id}/role-scopes`, {
      roleId: roleIds.SYSTEM_ADMIN,
      scopeType: 'TENANT',
    });
    expect(res.status).toBe(403);
  });

  it('even an administrator cannot change their own role assignments (API and database)', async () => {
    const res = await post(admin, `/users/${ids.admin}/role-scopes`, {
      roleId: roleIds.AUDITOR,
      scopeType: 'TENANT',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SELF_ASSIGNMENT_FORBIDDEN');
    await expect(
      owner.query(
        `INSERT INTO user_role_scopes (tenant_id, user_id, role_id, scope_type, scope_id, created_by, updated_at)
         SELECT tenant_id, id, $2, 'TENANT', tenant_id, id, now() FROM users WHERE id = $1`,
        [ids.admin, roleIds.AUDITOR],
      ),
    ).rejects.toThrow(/user_role_scopes_no_self_grant/);
  });

  it('rejects role scopes pointing at records that do not exist in the tenant', async () => {
    await expect(
      owner.query(
        `INSERT INTO user_role_scopes (tenant_id, user_id, role_id, scope_type, scope_id, updated_at)
         SELECT tenant_id, id, $2, 'JURISDICTION', gen_random_uuid(), now() FROM users WHERE id = $1`,
        [ids.admin, roleIds.AUDITOR],
      ),
    ).rejects.toThrow(/does not exist in tenant/);
  });

  it('creates custom roles, validates permission codes, keeps templates read-only and uses optimistic versions', async () => {
    const code = `CUSTOM_${Date.now()}`;
    expect(
      (
        await post(admin, '/roles', {
          code,
          name: 'Custom',
          permissions: ['scheme.view', 'nope.bad'],
        })
      ).status,
    ).toBe(400);
    const created = await post(admin, '/roles', {
      code,
      name: 'Custom',
      permissions: ['scheme.view', 'report.view'],
    });
    expect(created.status).toBe(201);
    expect(created.body.permissions).toEqual(['report.view', 'scheme.view']);
    const upd = await patch(admin, `/roles/${created.body.id}`, {
      version: created.body.version,
      permissions: ['scheme.view'],
    });
    expect(upd.status).toBe(200);
    expect(upd.body.permissions).toEqual(['scheme.view']);
    const stale = await patch(admin, `/roles/${created.body.id}`, {
      version: created.body.version,
      name: 'Stale',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('VERSION_CONFLICT');
    const tmpl = await patch(admin, `/roles/${roleIds.AUDITOR}`, {
      version: 1,
      permissions: ['scheme.view', 'scheme.edit'],
    });
    expect(tmpl.status).toBe(403);
    const audits = await owner.query(
      `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`,
      [created.body.id],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(['ROLE_CREATED', 'ROLE_UPDATED']);
  });

  it('role revocation takes effect on the very next request', async () => {
    const u = await newUser();
    const grant = await post(admin, `/users/${u.id}/role-scopes`, {
      roleId: roleIds.AUDITOR,
      scopeType: 'TENANT',
    });
    expect(grant.status).toBe(201);
    const s = await login(app, u.email, PW);
    expect((await s.agent.get('/api/v1/auth/me')).body.permissions).toContain('audit.view');
    expect((await del(admin, `/users/${u.id}/role-scopes/${grant.body.id}`)).status).toBe(200);
    expect((await s.agent.get('/api/v1/auth/me')).body.permissions).toEqual([]);
    const audits = await owner.query(
      `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at`,
      [grant.body.id],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(['ROLE_SCOPE_GRANTED', 'ROLE_SCOPE_REVOKED']);
  });

  it('scoped managers delegate only permissions they hold, only inside their jurisdiction', async () => {
    const roleCode = `DIST_A_USER_ADMIN_${Date.now()}`;
    const role = await post(admin, '/roles', {
      code: roleCode,
      name: 'District A user admin',
      permissions: ['user.manage', 'scheme.view', 'report.view'],
    });
    expect(role.status).toBe(201);
    const viewerRole = await post(admin, '/roles', {
      code: `${roleCode}_V`,
      name: 'Viewer',
      permissions: ['scheme.view'],
    });
    const manager = await newUser();
    await post(admin, `/users/${manager.id}/role-scopes`, {
      roleId: role.body.id,
      scopeType: 'JURISDICTION',
      scopeId: ids['DIST-A'],
      includeDescendants: true,
    }).expect(201);
    const m = await login(app, manager.email, PW);
    const target = await newUser();

    const tooMuch = await post(m, `/users/${target.id}/role-scopes`, {
      roleId: roleIds.STATE_PLANNER,
      scopeType: 'JURISDICTION',
      scopeId: ids['CD-A1'],
    });
    expect(tooMuch.status).toBe(403);
    expect(tooMuch.body.error).toBe('DELEGATION_EXCEEDS_AUTHORITY');
    const outside = await post(m, `/users/${target.id}/role-scopes`, {
      roleId: viewerRole.body.id,
      scopeType: 'JURISDICTION',
      scopeId: ids['DIST-B'],
    });
    expect(outside.status).toBe(403);
    expect(outside.body.error).toBe('SCOPE_OUTSIDE_AUTHORITY');
    const tenantWide = await post(m, `/users/${target.id}/role-scopes`, {
      roleId: viewerRole.body.id,
      scopeType: 'TENANT',
    });
    expect(tenantWide.status).toBe(403);
    const ok = await post(m, `/users/${target.id}/role-scopes`, {
      roleId: viewerRole.body.id,
      scopeType: 'JURISDICTION',
      scopeId: ids['CD-A1'],
    });
    expect(ok.status).toBe(201);
    // Users assigned in District B are invisible to the District A manager.
    const bUser = await newUser();
    await post(admin, `/users/${bUser.id}/role-scopes`, {
      roleId: viewerRole.body.id,
      scopeType: 'JURISDICTION',
      scopeId: ids['DIST-B'],
    }).expect(201);
    const users = await m.agent.get('/api/v1/users');
    expect(users.status).toBe(200);
    const emails = users.body.map((x: { email: string }) => x.email);
    expect(emails).toContain(target.email);
    expect(emails).not.toContain('state.planner@example.test');
    expect(emails).not.toContain(bUser.email);
    expect((await patch(m, `/users/${bUser.id}/status`, { status: 'SUSPENDED' })).status).toBe(404);
  });

  it('suspending a user through the API revokes their sessions; admins cannot suspend themselves', async () => {
    const u = await newUser();
    const s = await login(app, u.email, PW);
    expect(
      (await patch(admin, `/users/${u.id}/status`, { status: 'SUSPENDED', reason: 'test' })).status,
    ).toBe(200);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await patch(admin, `/users/${ids.admin}/status`, { status: 'SUSPENDED' })).status).toBe(
      403,
    );
  });

  it('denies cross-tenant access even with known IDs', async () => {
    await owner.query(
      `INSERT INTO tenants (name, code, updated_at) VALUES ('Other synthetic tenant', 'OTHER-RBAC', now()) ON CONFLICT (code) DO NOTHING`,
    );
    const other = await owner.query(
      `INSERT INTO users (tenant_id, email, name, updated_at) SELECT id, $1, 'Other', now() FROM tenants WHERE code = 'OTHER-RBAC' RETURNING id`,
      [unique('other')],
    );
    const otherRole = await owner.query(
      `INSERT INTO roles (tenant_id, code, name, updated_at) SELECT id, $1, 'Other role', now() FROM tenants WHERE code = 'OTHER-RBAC' RETURNING id`,
      [`R${Date.now()}`],
    );
    const otherId = other.rows[0].id;
    expect((await patch(admin, `/users/${otherId}/status`, { status: 'SUSPENDED' })).status).toBe(
      404,
    );
    expect(
      (
        await post(admin, `/users/${otherId}/role-scopes`, {
          roleId: roleIds.AUDITOR,
          scopeType: 'TENANT',
        })
      ).status,
    ).toBe(404);
    const u = await newUser();
    expect(
      (
        await post(admin, `/users/${u.id}/role-scopes`, {
          roleId: otherRole.rows[0].id,
          scopeType: 'TENANT',
        })
      ).status,
    ).toBe(404);
    const roles = await admin.agent.get('/api/v1/roles');
    expect(roles.body.map((r: { id: string }) => r.id)).not.toContain(otherRole.rows[0].id);
  });
});
