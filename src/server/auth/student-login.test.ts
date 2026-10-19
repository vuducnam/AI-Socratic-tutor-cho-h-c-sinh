import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminWorld,
  resetTestRedis,
  stubTurnstileSiteverify,
  TURNSTILE_FAIL_SECRET,
} from '../../../tests/helpers/auth-test-world';
import { closeTestDatabases, ownerDb, appDb } from '../../../tests/helpers/test-database';
import { mintActor } from '@/server/dal/mint-actor';
import { recordConsent, unlockStudentPin } from '@/server/dal/students-dal';
import { loginStudent, nextVietnamMidnight } from './student-login';
import { loadSession, decodeSessionCookie } from './session-store';

// SPEC §15.3b: đăng nhập học sinh, Turnstile, khoá PIN theo loại thiết bị, consent.
let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

beforeEach(async () => {
  await resetTestRedis();
  stubTurnstileSiteverify();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeTestDatabases();
});

const attempt = (username: string, pin: string, extra: { deviceToken?: string | null; token?: string | null; ip?: string } = {}) =>
  loginStudent({
    username,
    pin,
    turnstileToken: extra.token === undefined ? 'turnstile-token' : extra.token,
    deviceToken: extra.deviceToken ?? null,
    request: { ip: extra.ip ?? nextIp(), userAgent: 'vitest' },
  });

async function lockState(studentId: string, deviceClass: 'trusted' | 'unknown') {
  const { rows } = await appDb().query(
    'SELECT failed_count, hard_locked, locked_until FROM pin_lockouts WHERE student_id = $1 AND device_class = $2',
    [studentId, deviceClass],
  );
  return rows[0] as { failed_count: number; hard_locked: boolean; locked_until: Date | null } | undefined;
}

// Bỏ qua 15 phút khoá mềm trong test bằng cách lùi mốc khoá về quá khứ.
async function expireSoftLock(studentId: string) {
  await ownerDb().query(`UPDATE pin_lockouts SET locked_until = now() - interval '1 minute' WHERE student_id = $1`, [studentId]);
}

describe('đăng nhập học sinh', () => {
  it('hồ sơ admin vừa tạo đăng nhập được ngay, phiên hết hạn lúc nửa đêm giờ VN', async () => {
    const w = await createAdminWorld();
    const result = await attempt(w.username, w.pin);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deviceToken).toBeTruthy();
    const id = decodeSessionCookie('student', result.sessionCookie);
    const session = await loadSession('student', id!);
    expect(session?.subjectId).toBe(w.studentId);
    expect(session?.absoluteExpiresAt).toBe(nextVietnamMidnight());
  });

  it('sai tên và sai PIN cùng một thông báo', async () => {
    const w = await createAdminWorld();
    const wrongName = await attempt('khong-ton-tai-xyz', w.pin);
    const wrongPin = await attempt(w.username, '000000');
    expect(wrongName.ok || wrongPin.ok).toBe(false);
    if (!wrongName.ok && !wrongPin.ok) expect(wrongName.message).toBe(wrongPin.message);
  });

  it('Turnstile không hợp lệ → 403 và KHÔNG tăng bộ đếm sai PIN', async () => {
    const w = await createAdminWorld();
    process.env.TURNSTILE_SECRET_KEY = TURNSTILE_FAIL_SECRET;
    const r1 = await attempt(w.username, '000000');
    expect(r1).toMatchObject({ ok: false, status: 403, code: 'turnstile' });
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    const r2 = await attempt(w.username, '000000', { token: null });
    expect(r2).toMatchObject({ ok: false, status: 403, code: 'turnstile' });
    expect(await lockState(w.studentId, 'unknown')).toBeUndefined();
  });

  it('siteverify lỗi mạng → từ chối (fail closed)', async () => {
    const w = await createAdminWorld();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await attempt(w.username, w.pin)).toMatchObject({ ok: false, code: 'turnstile' });
  });

  it('sai 5 lần → khoá 15 phút; sai 10 lần liên tiếp → khoá tới khi phụ huynh mở, có cờ', async () => {
    const w = await createAdminWorld();
    for (let i = 1; i <= 4; i++) expect(await attempt(w.username, '000000')).toMatchObject({ code: 'invalid' });
    expect(await attempt(w.username, '000000')).toMatchObject({ status: 423, code: 'locked' });
    // Đang khoá mềm: PIN đúng cũng không vào được.
    expect(await attempt(w.username, w.pin)).toMatchObject({ code: 'locked' });
    await expireSoftLock(w.studentId);
    for (let i = 6; i <= 9; i++) expect(await attempt(w.username, '000000')).toMatchObject({ code: 'invalid' });
    expect(await attempt(w.username, '000000')).toMatchObject({ status: 423, code: 'hard_locked' });
    await expireSoftLock(w.studentId);
    expect(await attempt(w.username, w.pin)).toMatchObject({ code: 'hard_locked' });
    expect(await lockState(w.studentId, 'unknown')).toMatchObject({ failed_count: 10, hard_locked: true });

    const flags = await appDb().query('SELECT type, severity FROM flags WHERE student_id = $1 ORDER BY created_at', [w.studentId]);
    expect(flags.rows).toEqual([
      { type: 'pin_soft_locked', severity: 'warning' },
      { type: 'pin_hard_locked', severity: 'high' },
    ]);

    // Phụ huynh liên kết mở khoá → đăng nhập lại được.
    await unlockStudentPin(mintActor('parent', w.parentId), { studentId: w.studentId });
    expect((await attempt(w.username, w.pin)).ok).toBe(true);
  });

  it('thiết bị lạ sai 10 lần → thiết bị tin cậy của con vẫn đăng nhập được', async () => {
    const w = await createAdminWorld();
    const first = await attempt(w.username, w.pin);
    if (!first.ok) throw new Error('đăng nhập đầu tiên phải thành công');
    const trustedToken = first.deviceToken!;

    for (let i = 1; i <= 10; i++) {
      await attempt(w.username, '000000');
      if (i === 5) await expireSoftLock(w.studentId);
    }
    expect(await lockState(w.studentId, 'unknown')).toMatchObject({ hard_locked: true });
    expect(await attempt(w.username, w.pin)).toMatchObject({ code: 'hard_locked' });

    const fromTablet = await attempt(w.username, w.pin, { deviceToken: trustedToken });
    expect(fromTablet.ok).toBe(true);
    if (fromTablet.ok) expect(fromTablet.deviceToken).toBeNull();
  });

  it('học sinh ngoài gia đình chưa có consent không đăng nhập được; có consent thì được', async () => {
    const w = await createAdminWorld({ isFamily: false });
    expect(await attempt(w.username, w.pin)).toMatchObject({ status: 403, code: 'consent_required' });
    await recordConsent(w.admin, {
      studentId: w.studentId,
      parentId: w.parentId,
      version: 'v1',
      textSnapshot: 'Đồng ý',
      documentUri: null,
      childAcknowledged: true,
      signedAt: new Date(),
    });
    expect((await attempt(w.username, w.pin)).ok).toBe(true);
  });

  it('hai CF-Connecting-IP khác nhau có bộ đếm rate limit riêng', async () => {
    const w = await createAdminWorld();
    const ipA = '203.0.113.10';
    for (let i = 0; i < 20; i++) await attempt('khong-ton-tai', '000000', { ip: ipA });
    expect(await attempt(w.username, w.pin, { ip: ipA })).toMatchObject({ status: 429 });
    expect((await attempt(w.username, w.pin, { ip: '203.0.113.11' })).ok).toBe(true);
  });

  it('ghi access_log mọi lần đăng nhập thất bại, kèm IP và user agent', async () => {
    const w = await createAdminWorld();
    await attempt(w.username, '000000', { ip: '192.0.2.44' });
    const { rows } = await appDb().query(
      `SELECT host(ip) AS ip, user_agent, action FROM access_log WHERE student_id = $1 AND action = 'student_login_failed'`,
      [w.studentId],
    );
    expect(rows).toContainEqual({ ip: '192.0.2.44', user_agent: 'vitest', action: 'student_login_failed' });
  });
});
