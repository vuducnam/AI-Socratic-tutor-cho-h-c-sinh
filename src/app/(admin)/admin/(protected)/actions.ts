'use server';

import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { hashSecret, isValidPin, passwordProblem } from '@/server/auth/password';
import { ADMIN_SESSION_COOKIE, assertAdminRuntime, logoutCurrent } from '@/server/auth/session';
import { revokeAllSessions } from '@/server/auth/session-store';
import {
  createStudent,
  linkParentToStudent,
  recordConsent,
  resetStudentPin,
  setStudentStatus,
  unlinkParentFromStudent,
  unlockStudentPin,
} from '@/server/dal/students-dal';
import { createParentAccount, resetAccountPassword, setAccountStatus } from '@/server/dal/users-dal';
import { detectConsentDocumentType } from '@/server/storage/file-type';
import { writeStorageFile } from '@/server/storage/local-file-storage';

// Server Action quản trị. Mỗi action gọi assertAdminRuntime() trước tiên: Server Action gọi được bằng
// header Next-Action tới bất kỳ trang nào, nên không dựa vào proxy (phase 04). DAL kiểm lại lần nữa.

// Chưa có phiên admin hợp lệ hoặc ADMIN_ENABLED khác 'true' (container app) → 404, như mọi đường dẫn /admin.
async function requireAdmin() {
  try {
    return await assertAdminRuntime();
  } catch {
    notFound();
  }
}

function done(message: string): never {
  redirect(`/admin?ok=${encodeURIComponent(message)}`);
}
function fail(message: string): never {
  redirect(`/admin?err=${encodeURIComponent(message)}`);
}

const uuid = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);

export async function createParentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z
    .object({ name: text(100), email: z.email().max(200), password: z.string().max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thông tin phụ huynh chưa hợp lệ');
  const problem = passwordProblem(parsed.data.password);
  if (problem) fail(problem);
  try {
    await createParentAccount(actor, {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashSecret(parsed.data.password),
    });
  } catch {
    fail('Không tạo được tài khoản (email có thể đã tồn tại)');
  }
  done('Đã tạo tài khoản phụ huynh, dùng được ngay');
}

export async function createStudentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z
    .object({
      username: z.string().trim().regex(/^[a-z0-9._-]{3,32}$/i, 'Tên đăng nhập 3–32 ký tự không dấu'),
      displayName: text(50),
      gender: z.enum(['male', 'female']),
      pin: z.string(),
      grade: z.coerce.number().int().min(1).max(12),
      // Bắt buộc chọn, không suy diễn (học sinh ngoài gia đình cần consent, SPEC §2.3).
      isFamily: z.enum(['true', 'false']),
      interests: z.string().max(300).optional(),
      companionName: z.string().trim().max(30).optional(),
      parentId: z.union([uuid, z.literal('')]).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Thông tin học sinh chưa hợp lệ');
  if (!isValidPin(parsed.data.pin)) fail('PIN phải gồm đúng 6 chữ số');
  const preset = parsed.data.grade <= 5 ? 'grade5' : parsed.data.grade <= 7 ? 'grade6-7' : parsed.data.grade <= 9 ? 'grade8-9' : 'grade10-12';
  let studentId: string;
  try {
    studentId = await createStudent(actor, {
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      gender: parsed.data.gender,
      pinHash: await hashSecret(parsed.data.pin),
      grade: parsed.data.grade,
      preset,
      isFamily: parsed.data.isFamily === 'true',
      interests: (parsed.data.interests ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
      companionName: parsed.data.companionName || 'Mít',
    });
    if (parsed.data.parentId) await linkParentToStudent(actor, { parentId: parsed.data.parentId, studentId });
  } catch (err) {
    fail(err instanceof Error && err.message.includes('trùng') ? err.message : 'Không tạo được hồ sơ (tên đăng nhập có thể đã tồn tại)');
  }
  redirect(`/admin/students/${studentId}/progress?ok=${encodeURIComponent('Đã tạo hồ sơ. Đặt tiến độ trên lớp cho con.')}`);
}

export async function linkParentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ parentId: uuid, studentId: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Chọn phụ huynh và học sinh');
  await linkParentToStudent(actor, parsed.data);
  done('Đã liên kết');
}

export async function unlinkParentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ parentId: uuid, studentId: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thiếu thông tin');
  await unlinkParentFromStudent(actor, parsed.data);
  done('Đã gỡ liên kết');
}

export async function resetPasswordAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: uuid, password: z.string().max(200) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thiếu thông tin');
  const problem = passwordProblem(parsed.data.password);
  if (problem) fail(problem);
  await resetAccountPassword(actor, { userId: parsed.data.userId, passwordHash: await hashSecret(parsed.data.password) });
  await Promise.all([revokeAllSessions('parent', parsed.data.userId), revokeAllSessions('admin', parsed.data.userId)]);
  done('Đã đặt lại mật khẩu, các phiên cũ bị đăng xuất');
}

export async function setUserStatusAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: uuid, status: z.enum(['active', 'disabled']) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thiếu thông tin');
  await setAccountStatus(actor, parsed.data);
  if (parsed.data.status === 'disabled') {
    await Promise.all([revokeAllSessions('parent', parsed.data.userId), revokeAllSessions('admin', parsed.data.userId)]);
  }
  done(parsed.data.status === 'disabled' ? 'Đã khoá tài khoản' : 'Đã mở tài khoản');
}

export async function resetPinAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ studentId: uuid, pin: z.string() }).safeParse(Object.fromEntries(form));
  if (!parsed.success || !isValidPin(parsed.data.pin)) fail('PIN phải gồm đúng 6 chữ số');
  await resetStudentPin(actor, { studentId: parsed.data.studentId, pinHash: await hashSecret(parsed.data.pin) });
  await revokeAllSessions('student', parsed.data.studentId);
  done('Đã đặt lại PIN và mở khoá');
}

export async function setStudentStatusAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ studentId: uuid, status: z.enum(['active', 'disabled']) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thiếu thông tin');
  await setStudentStatus(actor, parsed.data);
  if (parsed.data.status === 'disabled') await revokeAllSessions('student', parsed.data.studentId);
  done(parsed.data.status === 'disabled' ? 'Đã khoá hồ sơ học sinh' : 'Đã mở hồ sơ học sinh');
}

export async function unlockStudentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z.object({ studentId: uuid }).safeParse(Object.fromEntries(form));
  if (!parsed.success) fail('Thiếu thông tin');
  await unlockStudentPin(actor, parsed.data);
  done('Đã mở khoá PIN');
}

const MAX_CONSENT_BYTES = 10 * 1024 * 1024;

export async function recordConsentAction(form: FormData) {
  const actor = await requireAdmin();
  const parsed = z
    .object({
      studentId: uuid,
      parentId: uuid,
      version: text(20),
      textSnapshot: text(20_000),
      signedAt: z.iso.date(),
      childAcknowledged: z.literal('on').optional(),
    })
    .safeParse(Object.fromEntries([...form.entries()].filter(([k]) => k !== 'document')));
  if (!parsed.success) fail('Thông tin xác nhận đồng ý chưa đủ');

  let documentUri: string | null = null;
  const file = form.get('document');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CONSENT_BYTES) fail('File quá 10 MB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectConsentDocumentType(bytes);
    if (!type) fail('Chỉ nhận PDF, JPEG hoặc PNG');
    documentUri = await writeStorageFile(`consents/${randomUUID()}.${type}`, bytes);
  }
  await recordConsent(actor, {
    studentId: parsed.data.studentId,
    parentId: parsed.data.parentId,
    version: parsed.data.version,
    textSnapshot: parsed.data.textSnapshot,
    documentUri,
    childAcknowledged: parsed.data.childAcknowledged === 'on',
    signedAt: new Date(parsed.data.signedAt),
  });
  done('Đã ghi nhận xác nhận đồng ý');
}

export async function adminLogoutAction() {
  await logoutCurrent(ADMIN_SESSION_COOKIE);
  redirect('/admin/login');
}
