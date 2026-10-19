import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate } from 'otplib';
import { createAdminWorld, resetTestRedis, stubTurnstileSiteverify } from '../../../tests/helpers/auth-test-world';
import { closeTestDatabases } from '../../../tests/helpers/test-database';
import { setOwnTotpSecret } from '@/server/dal/users-dal';
import { mintActor } from '@/server/dal/mint-actor';
import { loginAccount } from './account-login';
import { encryptTotpSecret, newTotpSecret } from './totp';
import { createSession, revokeAllSessions, revokeOtherSessions, loadSession } from './session-store';

let ipSeq = 0;
const login = (role: 'parent' | 'admin', email: string, password: string, totpCode: string | null = null) =>
  loginAccount({
    role,
    email,
    password,
    totpCode,
    turnstileToken: 'turnstile-token',
    request: { ip: `198.51.100.${200 + (++ipSeq % 50)}`, userAgent: 'vitest' },
  });

beforeEach(async () => {
  await resetTestRedis();
  stubTurnstileSiteverify();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeTestDatabases();
});

describe('đăng nhập phụ huynh/admin', () => {
  it('tài khoản phụ huynh vừa tạo đăng nhập được ngay', async () => {
    const w = await createAdminWorld();
    expect(await login('parent', w.parentEmail, w.password)).toMatchObject({ ok: true, kind: 'parent' });
  });

  it('cổng công khai từ chối tài khoản admin', async () => {
    const w = await createAdminWorld();
    expect(await login('parent', w.adminEmail, 'admin-password-123')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('admin chỉ đăng nhập được khi ADMIN_ENABLED=true', async () => {
    const w = await createAdminWorld();
    expect(await login('admin', w.adminEmail, 'admin-password-123')).toMatchObject({ ok: true, kind: 'admin' });
    process.env.ADMIN_ENABLED = 'false';
    try {
      expect(await login('admin', w.adminEmail, 'admin-password-123')).toMatchObject({ ok: false, status: 404 });
    } finally {
      process.env.ADMIN_ENABLED = 'true';
    }
  });

  it('TOTP đã bật: cần mã đúng', async () => {
    const w = await createAdminWorld();
    const secret = newTotpSecret();
    await setOwnTotpSecret(mintActor('parent', w.parentId), { totpSecretEnc: encryptTotpSecret(secret) });
    expect(await login('parent', w.parentEmail, w.password)).toMatchObject({ ok: false, code: 'totp_required' });
    expect(await login('parent', w.parentEmail, w.password, '000000')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await login('parent', w.parentEmail, w.password, await generate({ secret }))).toMatchObject({ ok: true });
  });

  it('thu hồi mọi phiên của một người dùng', async () => {
    const a = await createSession('parent', 'user-x');
    const b = await createSession('parent', 'user-x');
    expect(await revokeAllSessions('parent', 'user-x')).toBe(2);
    expect(await loadSession('parent', a.id)).toBeNull();
    expect(await loadSession('parent', b.id)).toBeNull();
  });

  it('thu hồi các phiên khác, giữ phiên đang dùng', async () => {
    const keep = await createSession('parent', 'user-y');
    const other = await createSession('parent', 'user-y');
    const unrelated = await createSession('parent', 'user-z');
    expect(await revokeOtherSessions('parent', 'user-y', keep.id)).toBe(1);
    expect(await loadSession('parent', keep.id)).not.toBeNull();
    expect(await loadSession('parent', other.id)).toBeNull();
    expect(await loadSession('parent', unrelated.id)).not.toBeNull();
    expect(await revokeOtherSessions('parent', 'user-y', keep.id)).toBe(0);
  });
});
