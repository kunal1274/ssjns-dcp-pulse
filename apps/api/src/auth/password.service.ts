import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import { newToken } from './tokens';

export const PASSWORD_MIN_LENGTH = 12;

/** Argon2id hashing; legacy bcrypt hashes verify once and are then upgraded. */
@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (hash.startsWith('$argon2')) {
      return { ok: await argon2.verify(hash, password), needsRehash: false };
    }
    if (/^\$2[aby]\$/.test(hash)) {
      return { ok: await bcrypt.compare(password, hash), needsRehash: true };
    }
    return { ok: false, needsRehash: false };
  }

  /** Burns comparable CPU when the user does not exist, to blunt timing-based enumeration. */
  private dummyHash?: Promise<string>;
  async dummyVerify(password: string): Promise<void> {
    this.dummyHash ??= this.hash(newToken());
    await argon2.verify(await this.dummyHash, password).catch(() => false);
  }

  validateStrength(password: string): string | null {
    if (password.length < PASSWORD_MIN_LENGTH)
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
    if (password.length > 256) return 'Password is too long';
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
      return 'Password must contain letters and numbers';
    return null;
  }
}
