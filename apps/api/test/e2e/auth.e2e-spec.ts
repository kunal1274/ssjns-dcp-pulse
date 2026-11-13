import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Client } from 'pg';
import type { CapturingMailSender } from '../../src/mail/mail.service';
import { ownerClient } from '../integration/db';
import { createApp, login, PASSWORD, tokenFrom, unique } from './helpers';

const NEW_PASSWORD = 'Synthetic-Pass-2026';

describe('F04 authentication and sessions (e2e, real database)', () => {
  let app: INestApplication;
  let mail: CapturingMailSender;
  let owner: Client;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    owner = await ownerClient();
  });
  afterAll(async () => {
    await owner.end();
    await app.close();
  });

  async function inviteAndAccept(password = NEW_PASSWORD): Promise<string> {
    const admin = await login(app, 'admin@example.test');
    const email = unique('invitee');
    const res = await admin.agent
      .post('/api/v1/users/invite')
      .set('x-csrf-token', admin.csrf)
      .send({ email, name: 'Invited Officer' });
    expect(res.status).toBe(201);
    const token = tokenFrom(mail.sent.at(-1)!.body);
    expect(
      (await http().post('/api/v1/auth/accept-invite').send({ token, newPassword: password }))
        .status,
    ).toBe(204);
    return email;
  }

  it('login sets an HttpOnly session cookie and a readable CSRF cookie', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'state.planner@example.test', password: PASSWORD() });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('dcp_session='))!;
    const csrf = cookies.find((c) => c.startsWith('dcp_csrf='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(res.body.csrfToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it('GET /auth/me returns the user, tenant, role scopes and permissions from the database', async () => {
    const s = await login(app, 'state.planner@example.test');
    const res = await s.agent.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('state.planner@example.test');
    expect(res.body.tenant.code).toBe('ASSAM-DEMO');
    expect(res.body.roles[0]).toMatchObject({ roleCode: 'STATE_PLANNER', scopeType: 'TENANT' });
    expect(res.body.permissions).toContain('budget.allocate');
  });

  it('returns an identical generic error for unknown users, wrong passwords and unknown tenants', async () => {
    const a = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'x' });
    const b = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'auditor@example.test', password: 'wrong-password-1' });
    const c = await http()
      .post('/api/v1/auth/login')
      .send({ tenantCode: 'NOPE', email: 'auditor@example.test', password: PASSWORD() });
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('INVALID_CREDENTIALS');
      expect(r.body.message).toBe('Invalid email or password.');
    }
  });

  it('rejects protected routes without a session and with a forged cookie', async () => {
    expect((await http().get('/api/v1/auth/me')).status).toBe(401);
    expect((await http().get('/api/v1/auth/me').set('Cookie', 'dcp_session=forged')).status).toBe(
      401,
    );
  });

  it('requires a valid CSRF token on state-changing requests', async () => {
    const s = await login(app, 'auditor@example.test');
    expect((await s.agent.post('/api/v1/auth/logout')).status).toBe(403);
    expect((await s.agent.post('/api/v1/auth/logout').set('x-csrf-token', 'wrong')).status).toBe(
      403,
    );
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('logout revokes the session server-side; the old cookie no longer works', async () => {
    const s = await login(app, 'state.monitor@example.test');
    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    const res = await s.agent.post('/api/v1/auth/logout').set('x-csrf-token', s.csrf);
    expect(res.status).toBe(204);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('logout-all revokes every session of the user', async () => {
    const s1 = await login(app, 'codistrict.reviewer@example.test');
    const s2 = await login(app, 'codistrict.reviewer@example.test');
    const res = await s1.agent.post('/api/v1/auth/logout-all').set('x-csrf-token', s1.csrf);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(2);
    expect((await s2.agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('invited users cannot log in until they accept the invitation', async () => {
    const admin = await login(app, 'admin@example.test');
    const email = unique('pending');
    await admin.agent
      .post('/api/v1/users/invite')
      .set('x-csrf-token', admin.csrf)
      .send({ email, name: 'Pending' })
      .expect(201);
    const r = await http().post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD });
    expect(r.status).toBe(401);
    const status = await owner.query(`SELECT status FROM users WHERE email = $1`, [email]);
    expect(status.rows[0].status).toBe('INVITED');
  });

  it('only users with user.manage can invite; duplicate invites conflict', async () => {
    const officer = await login(app, 'field.officer@example.test');
    const res = await officer.agent
      .post('/api/v1/users/invite')
      .set('x-csrf-token', officer.csrf)
      .send({ email: unique('x'), name: 'X' });
    expect(res.status).toBe(403);
    const admin = await login(app, 'admin@example.test');
    const dup = await admin.agent
      .post('/api/v1/users/invite')
      .set('x-csrf-token', admin.csrf)
      .send({ email: 'auditor@example.test', name: 'Dup' });
    expect(dup.status).toBe(409);
  });

  it('accepting an invite activates the account; the token is single-use', async () => {
    const email = await inviteAndAccept();
    const token = tokenFrom(mail.sent.at(-1)!.body);
    expect(
      (await http().post('/api/v1/auth/accept-invite').send({ token, newPassword: NEW_PASSWORD }))
        .status,
    ).toBe(400);
    await login(app, email, NEW_PASSWORD);
  });

  it('password reset: generic response, expiring single-use token, revokes existing sessions', async () => {
    const email = await inviteAndAccept();
    const before = await login(app, email, NEW_PASSWORD);
    const sentBefore = mail.sent.length;
    const unknown = await http()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(202);
    expect(mail.sent.length).toBe(sentBefore);
    const known = await http().post('/api/v1/auth/forgot-password').send({ email });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    const token = tokenFrom(mail.sent.at(-1)!.body);
    const weak = await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'short' });
    expect(weak.status).toBe(400);
    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'Another-Pass-2027' })
      .expect(204);
    expect(
      (
        await http()
          .post('/api/v1/auth/reset-password')
          .send({ token, newPassword: 'Another-Pass-2028' })
      ).status,
    ).toBe(400);
    expect((await before.agent.get('/api/v1/auth/me')).status).toBe(401);
    await login(app, email, 'Another-Pass-2027');
    const stored = await owner.query(
      `SELECT count(*)::int n FROM password_reset_tokens WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [token],
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it('expired reset tokens are rejected', async () => {
    const email = await inviteAndAccept();
    await http().post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFrom(mail.sent.at(-1)!.body);
    await owner.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
      [token],
    );
    expect(
      (
        await http()
          .post('/api/v1/auth/reset-password')
          .send({ token, newPassword: 'Another-Pass-2029' })
      ).status,
    ).toBe(400);
  });

  it('locks the account after repeated failures, even for the correct password', async () => {
    const email = await inviteAndAccept();
    for (let i = 0; i < 5; i++) {
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password-1' })
        .expect(401);
    }
    expect(
      (await http().post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD })).status,
    ).toBe(401);
    const ev = await owner.query(
      `SELECT e.outcome, e.details_json->>'reason' reason FROM authentication_events e JOIN users u ON u.id = e.user_id
       WHERE u.email = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [email],
    );
    expect(ev.rows[0]).toMatchObject({ outcome: 'DENIED', reason: 'LOCKED' });
  });

  it('suspended users are denied and their existing sessions stop working', async () => {
    const email = await inviteAndAccept();
    const s = await login(app, email, NEW_PASSWORD);
    await owner.query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [email]);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (await http().post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD })).status,
    ).toBe(401);
  });

  it('expired sessions are rejected', async () => {
    const s = await login(app, 'auditor@example.test');
    await owner.query(`UPDATE user_sessions SET idle_expires_at = LEAST(absolute_expires_at, now() - interval '1 second')
      WHERE user_id = (SELECT id FROM users WHERE email = 'auditor@example.test') AND revoked_at IS NULL`);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('records authentication events append-only, without secrets', async () => {
    const rows = await owner.query(
      `SELECT event_type, outcome, details_json::text d FROM authentication_events`,
    );
    const types = new Set(rows.rows.map((r) => r.event_type));
    for (const t of [
      'LOGIN',
      'LOGOUT',
      'LOGOUT_ALL',
      'PASSWORD_RESET_REQUEST',
      'PASSWORD_RESET',
      'INVITE_ACCEPTED',
    ])
      expect(types).toContain(t);
    expect(rows.rows.map((r) => r.d ?? '').join('')).not.toMatch(
      /"(password|newPassword|token|passwordHash|csrfToken)"\s*:/i,
    );
    await expect(
      owner.query(`UPDATE authentication_events SET outcome = 'SUCCESS'`),
    ).rejects.toThrow(/append-only/);
  });
});
