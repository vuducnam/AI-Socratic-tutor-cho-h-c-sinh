import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { appendAccessLog, type RequestContext } from '@/server/dal/access-log-dal';
import { createLoginSecurityFlag } from '@/server/dal/flags-dal';
import {
  addTrustedDevice,
  clearPinFailures,
  findStudentForLogin,
  getPinLockState,
  hasActiveConsent,
  isTrustedDevice,
  registerPinFailure,
  type DeviceClass,
} from '@/server/dal/students-dal';
import { enqueueParentNotification } from '@/server/jobs/enqueue-parent-notification';
import { verifyAgainstDummy, verifySecret } from './password';
import { hitRateLimit, LOGIN_RATE_LIMITS } from './rate-limit';
import { createSession, encodeSessionCookie } from './session-store';
import { verifyTurnstileToken } from './turnstile-verify';

// Đăng nhập học sinh: tên đăng nhập + PIN 6 số (SPEC §2.2 bước 4–5). Thứ tự bắt buộc:
// rate limit IP → Turnstile (sai thì 403, KHÔNG tính vào số lần sai) → rate limit tài khoản → tra hồ sơ →
// khoá theo loại thiết bị → kiểm PIN. Thông báo lỗi giống nhau cho sai tên và sai PIN.

export interface StudentLoginInput {
  username: string;
  pin: string;
  turnstileToken: string | null;
  deviceToken: string | null;
  request: RequestContext;
}

export type StudentLoginResult =
  | { ok: true; sessionCookie: string; studentId: string; deviceToken: string | null; expiresAt: number }
  | {
      ok: false;
      status: 401 | 403 | 423 | 429;
      code: 'invalid' | 'turnstile' | 'locked' | 'hard_locked' | 'rate_limited' | 'consent_required';
      message: string;
    };

const GENERIC_INVALID = 'Tên đăng nhập hoặc mã PIN chưa đúng.';

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(`cu-device:${token}`).digest('hex');
}

/** Phiên học sinh hết khi sang ngày mới theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function nextVietnamMidnight(now = Date.now()): number {
  const offset = 7 * 3600_000;
  const local = new Date(now + offset);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - offset;
}

async function logFailure(studentId: string | null, reason: string, request: RequestContext) {
  await appendAccessLog({ actorType: 'anonymous', studentId, action: 'student_login_failed', resource: reason, request });
}

async function flagLock(studentId: string, kind: 'pin_soft_locked' | 'pin_hard_locked', deviceClass: DeviceClass) {
  const flagId = await createLoginSecurityFlag(studentId, kind, { device_class: deviceClass });
  await enqueueParentNotification(flagId);
}

export async function loginStudent(input: StudentLoginInput): Promise<StudentLoginResult> {
  const ipKey = input.request.ip ?? 'unknown';
  if (!(await hitRateLimit(LOGIN_RATE_LIMITS.perIp, ipKey)).allowed) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Thử lại sau ít phút nhé.' };
  }

  const turnstile = await verifyTurnstileToken(input.turnstileToken);
  if (!turnstile.ok) {
    await logFailure(null, `turnstile:${turnstile.reason}`, input.request);
    return { ok: false, status: 403, code: 'turnstile', message: 'Chưa xác minh được, con thử lại nhé.' };
  }

  const username = input.username.trim().toLowerCase();
  const student = await findStudentForLogin(username);
  const deviceTrusted =
    !!student && !!input.deviceToken && (await isTrustedDevice(student.id, hashDeviceToken(input.deviceToken)));
  const deviceClass: DeviceClass = deviceTrusted ? 'trusted' : 'unknown';

  // Rate limit tài khoản tách theo loại thiết bị: người lạ dò PIN không chặn được tablet của con.
  if (!(await hitRateLimit(LOGIN_RATE_LIMITS.perAccount, `student:${username}:${deviceClass}`)).allowed) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Thử lại sau ít phút nhé.' };
  }

  if (!student || student.status !== 'active') {
    await verifyAgainstDummy(input.pin);
    await logFailure(student?.id ?? null, student ? 'disabled' : 'unknown_username', input.request);
    return { ok: false, status: 401, code: 'invalid', message: GENERIC_INVALID };
  }

  const lock = await getPinLockState(student.id, deviceClass);
  if (lock.hardLocked) {
    await logFailure(student.id, `hard_locked:${deviceClass}`, input.request);
    return { ok: false, status: 423, code: 'hard_locked', message: 'Tài khoản đang tạm khoá. Con nhờ bố mẹ mở giúp nhé.' };
  }
  if (lock.lockedUntil && lock.lockedUntil.getTime() > Date.now()) {
    await logFailure(student.id, `soft_locked:${deviceClass}`, input.request);
    return { ok: false, status: 423, code: 'locked', message: 'Con đợi 15 phút rồi thử lại nhé.' };
  }

  if (!(await verifySecret(student.pin_hash, input.pin))) {
    const outcome = await registerPinFailure(student.id, deviceClass);
    await logFailure(student.id, `wrong_pin:${deviceClass}:${outcome.failedCount}`, input.request);
    if (outcome.lock === 'hard') {
      await flagLock(student.id, 'pin_hard_locked', deviceClass);
      return { ok: false, status: 423, code: 'hard_locked', message: 'Tài khoản đang tạm khoá. Con nhờ bố mẹ mở giúp nhé.' };
    }
    if (outcome.lock === 'soft') {
      await flagLock(student.id, 'pin_soft_locked', deviceClass);
      return { ok: false, status: 423, code: 'locked', message: 'Con đợi 15 phút rồi thử lại nhé.' };
    }
    return { ok: false, status: 401, code: 'invalid', message: GENERIC_INVALID };
  }

  if (!student.is_family && !(await hasActiveConsent(student.id))) {
    await logFailure(student.id, 'consent_missing', input.request);
    return { ok: false, status: 403, code: 'consent_required', message: 'Hồ sơ của con chưa sẵn sàng. Con nhờ bố mẹ nhé.' };
  }

  await clearPinFailures(student.id, deviceClass);
  let newDeviceToken: string | null = null;
  if (!deviceTrusted) {
    newDeviceToken = randomBytes(32).toString('base64url');
    await addTrustedDevice(student.id, hashDeviceToken(newDeviceToken));
  }
  const expiresAt = nextVietnamMidnight();
  const session = await createSession('student', student.id, { absoluteExpiresAt: expiresAt });
  await appendAccessLog({
    actorType: 'student',
    actorId: student.id,
    studentId: student.id,
    action: 'student_login',
    resource: deviceClass,
    request: input.request,
  });
  return {
    ok: true,
    sessionCookie: encodeSessionCookie('student', session.id),
    studentId: student.id,
    deviceToken: newDeviceToken,
    expiresAt,
  };
}
