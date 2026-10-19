'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { hashSecret, passwordProblem, verifySecret } from '@/server/auth/password';
import { hitRateLimit } from '@/server/auth/rate-limit';
import { currentAppSession, requireParentActor } from '@/server/auth/session';
import { revokeOtherSessions } from '@/server/auth/session-store';
import { encryptTotpSecret, verifyTotpCode } from '@/server/auth/totp';
import { updateStudentPreferences } from '@/server/dal/parent-settings-dal';
import { changeOwnPassword, getOwnAccount, setOwnTotpSecret } from '@/server/dal/users-dal';
import { errorMessage, noticeUrl } from '../_lib/parent-page-helpers';

// Server Action trang Cấu hình. Mỗi action tự lấy actor từ phiên; DAL kiểm liên kết phụ huynh–học sinh.

const PATH = '/parent/settings';

function back(notice: { ok?: string; err?: string }, studentId?: string): never {
  redirect(noticeUrl(PATH, notice, studentId ? { studentId } : {}));
}

const preferencesForm = z.object({
  studentId: z.uuid(),
  interests: z.string().max(500).default(''),
  sessionMinutes: z.coerce.number({ error: 'Thời lượng phải là số' }).int(),
  dailyLimitMinutes: z.coerce.number({ error: 'Giới hạn phải là số' }).int(),
});

export async function updatePreferencesAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = preferencesForm.safeParse({
    studentId: form.get('studentId'),
    interests: form.get('interests') ?? '',
    sessionMinutes: form.get('sessionMinutes'),
    dailyLimitMinutes: form.get('dailyLimitMinutes'),
  });
  if (!parsed.success) back({ err: parsed.error.issues[0]?.message ?? 'Thông tin chưa hợp lệ' });
  const { studentId, interests, sessionMinutes, dailyLimitMinutes } = parsed.data;
  let error: string | null = null;
  try {
    await updateStudentPreferences(actor, {
      studentId,
      preferences: {
        interests: interests.split(',').map((s) => s.trim()).filter(Boolean),
        sessionMinutes,
        dailyLimitMinutes,
      },
    });
  } catch (err) {
    error = errorMessage(err, 'Thông tin chưa hợp lệ');
  }
  back(error ? { err: error } : { ok: 'Đã lưu hồ sơ' }, studentId);
}

// Phiên bị chiếm không được dùng form này để dò mật khẩu hiện tại.
const REAUTH_RATE_LIMIT = { name: 'parent-reauth', limit: 10, windowSeconds: 600 };

/** Kiểm mật khẩu hiện tại của chính tài khoản đang đăng nhập. */
async function currentPasswordMatches(actor: Awaited<ReturnType<typeof requireParentActor>>, password: unknown) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) return false;
  if (!(await hitRateLimit(REAUTH_RATE_LIMIT, actor.id)).allowed) back({ err: 'Thử quá nhiều lần, đợi 10 phút rồi thử lại' });
  const account = await getOwnAccount(actor);
  return verifySecret(account.password_hash, password);
}

export async function changePasswordAction(form: FormData) {
  const actor = await requireParentActor();
  const newPassword = String(form.get('newPassword') ?? '');
  if (newPassword !== String(form.get('confirmPassword') ?? '')) back({ err: 'Hai lần nhập mật khẩu mới không khớp' });
  const problem = passwordProblem(newPassword);
  if (problem) back({ err: problem });
  if (!(await currentPasswordMatches(actor, form.get('currentPassword')))) back({ err: 'Mật khẩu hiện tại không đúng' });
  await changeOwnPassword(actor, { passwordHash: await hashSecret(newPassword) });
  // Mật khẩu cũ có thể đã lộ: đăng xuất mọi thiết bị khác, giữ phiên đang đổi mật khẩu.
  const current = await currentAppSession();
  if (current) await revokeOtherSessions('parent', actor.id, current.id);
  back({ ok: 'Đã đổi mật khẩu, các thiết bị khác đã bị đăng xuất' });
}

const enableTotpForm = z.object({
  secret: z.string().regex(/^[A-Z2-7]{16,128}$/, 'Khoá TOTP không hợp lệ'),
  code: z.string().regex(/^\d{6}$/, 'Mã gồm 6 chữ số'),
});

export async function enableTotpAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = enableTotpForm.safeParse({ secret: form.get('secret'), code: form.get('code') });
  if (!parsed.success) back({ err: parsed.error.issues[0]?.message ?? 'Mã không hợp lệ' });
  if (!(await verifyTotpCode(parsed.data.secret, parsed.data.code))) {
    back({ err: 'Mã chưa đúng, thử lại với khoá mới' });
  }
  await setOwnTotpSecret(actor, { totpSecretEnc: encryptTotpSecret(parsed.data.secret) });
  back({ ok: 'Đã bật TOTP' });
}

export async function disableTotpAction(form: FormData) {
  const actor = await requireParentActor();
  if (!(await currentPasswordMatches(actor, form.get('currentPassword')))) back({ err: 'Mật khẩu hiện tại không đúng' });
  await setOwnTotpSecret(actor, { totpSecretEnc: null });
  back({ ok: 'Đã tắt TOTP' });
}
