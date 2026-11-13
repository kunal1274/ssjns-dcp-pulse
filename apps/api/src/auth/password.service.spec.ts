import bcrypt from 'bcryptjs';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes with Argon2id and verifies', async () => {
    const h = await svc.hash('Correct-Horse-1');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(h, 'Correct-Horse-1')).toEqual({ ok: true, needsRehash: false });
    expect((await svc.verify(h, 'wrong')).ok).toBe(false);
  });

  it('accepts legacy bcrypt hashes and flags them for rehash', async () => {
    const h = await bcrypt.hash('Legacy-Pass-1', 4);
    expect(await svc.verify(h, 'Legacy-Pass-1')).toEqual({ ok: true, needsRehash: true });
  });

  it('rejects unknown hash formats and weak passwords', async () => {
    expect((await svc.verify('plain', 'plain')).ok).toBe(false);
    expect(svc.validateStrength('short1')).toMatch(/at least/);
    expect(svc.validateStrength('lettersonlyletters')).toMatch(/letters and numbers/);
    expect(svc.validateStrength('Good-Pass-2026')).toBeNull();
  });
});
