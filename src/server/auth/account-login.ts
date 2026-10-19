import 'server-only';
import { appendAccessLog, type RequestContext } from '@/server/dal/access-log-dal';
import { findUserForLogin, normalizeEmail, recordUserLogin } from '@/server/dal/users-dal';
import { verifyAgainstDummy, verifySecret } from './password';
import { hitRateLimit, LOGIN_RATE_LIMITS } from './rate-limit';
import { createSession, encodeSessionCookie, type SessionKind } from './session-store';
import { decryptTotpSecret, verifyTotpCode } from './totp';
import { verifyTurnstileToken } from './turnstile-verify';

// Đăng nhập email + mật khẩu (+ TOTP nếu đã bật). `role`:
// - 'parent': cổng công khai; tài khoản role admin bị từ chối (admin dùng tài khoản parent riêng cho /parent);
// - 'admin': chỉ container admin (ADMIN_ENABLED=true), cookie và secret ký riêng.

export interface AccountLoginInput {
  role: 'parent' | 'admin';
  email: string;
  password: string;
  totpCode: string | null;
  turnstileToken: string | null;
  request: RequestContext;
}

export type AccountLoginResult =
  | { ok: true; sessionCookie: string; userId: string; kind: SessionKind }
  | {
      ok: false;
      status: 401 | 403 | 404 | 429;
      code: 'invalid' | 'turnstile' | 'rate_limited' | 'totp_required' | 'disabled_here';
      message: string;
    };

const GENERIC_INVALID = 'Email hoặc mật khẩu chưa đúng.';

async function logFailure(actorId: string | null, reason: string, request: RequestContext) {
  await appendAccessLog({ actorType: 'anonymous', actorId, action: 'account_login_failed', resource: reason, request });
}

export async function loginAccount(input: AccountLoginInput): Promise<AccountLoginResult> {
  if (input.role === 'admin' && process.env.ADMIN_ENABLED !== 'true') {
    return { ok: false, status: 404, code: 'disabled_here', message: 'Not found' };
  }
  const ipKey = input.request.ip ?? 'unknown';
  if (!(await hitRateLimit(LOGIN_RATE_LIMITS.perIp, ipKey)).allowed) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Thử lại sau ít phút.' };
  }
  const turnstile = await verifyTurnstileToken(input.turnstileToken);
  if (!turnstile.ok) {
    await logFailure(null, `turnstile:${turnstile.reason}`, input.request);
    return { ok: false, status: 403, code: 'turnstile', message: 'Chưa xác minh được, vui lòng thử lại.' };
  }
  const email = normalizeEmail(input.email);
  if (!(await hitRateLimit(LOGIN_RATE_LIMITS.perAccount, `account:${email}`)).allowed) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Thử lại sau ít phút.' };
  }

  const user = await findUserForLogin(email);
  if (!user || user.status !== 'active' || user.role !== input.role) {
    await verifyAgainstDummy(input.password);
    await logFailure(user?.id ?? null, user ? `role_or_status:${user.role}:${user.status}` : 'unknown_email', input.request);
    return { ok: false, status: 401, code: 'invalid', message: GENERIC_INVALID };
  }
  if (!(await verifySecret(user.password_hash, input.password))) {
    await logFailure(user.id, 'wrong_password', input.request);
    return { ok: false, status: 401, code: 'invalid', message: GENERIC_INVALID };
  }
  if (user.totp_secret_enc) {
    if (!input.totpCode) {
      return { ok: false, status: 401, code: 'totp_required', message: 'Nhập mã 6 số từ ứng dụng xác thực.' };
    }
    if (!(await verifyTotpCode(decryptTotpSecret(user.totp_secret_enc), input.totpCode))) {
      await logFailure(user.id, 'wrong_totp', input.request);
      return { ok: false, status: 401, code: 'invalid', message: 'Mã xác thực chưa đúng.' };
    }
  }

  const kind: SessionKind = input.role;
  const session = await createSession(kind, user.id);
  await recordUserLogin(user.id);
  await appendAccessLog({ actorType: kind, actorId: user.id, action: `${kind}_login`, request: input.request });
  return { ok: true, sessionCookie: encodeSessionCookie(kind, session.id), userId: user.id, kind };
}
