import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_TEMPLATES } from './permissions';

describe('permission catalogue', () => {
  it('has the 23 unique permission codes from the specification', () => {
    const codes = PERMISSIONS.map((perm) => perm.code);
    expect(codes).toHaveLength(23);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('derives resource and action from the code', () => {
    const perm = PERMISSIONS.find((x) => x.code === 'budget.request.create');
    expect(perm).toMatchObject({ resource: 'budget.request', action: 'create' });
  });

  it('only references known permissions in role templates', () => {
    const known = new Set(PERMISSIONS.map((perm) => perm.code));
    for (const role of ROLE_TEMPLATES) {
      for (const code of role.permissions) expect(known.has(code)).toBe(true);
    }
  });

  it('has the eight initial role templates', () => {
    expect(ROLE_TEMPLATES).toHaveLength(8);
  });

  it('does not grant budget approval or verification to System Administrator', () => {
    const admin = ROLE_TEMPLATES.find((r) => r.code === 'SYSTEM_ADMIN');
    expect(admin).toBeDefined();
    for (const forbidden of [
      'budget.allocate',
      'budget.revise',
      'scheme.approve',
      'expenditure.verify',
      'progress.verify',
    ]) {
      expect(admin?.permissions).not.toContain(forbidden);
    }
  });
});
