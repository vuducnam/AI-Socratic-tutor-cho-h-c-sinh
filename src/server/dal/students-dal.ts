import 'server-only';
import type { Actor } from './actor';
import { appendActorAccessLog } from './access-log-dal';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertAdmin } from './role-guards';

// Hồ sơ học sinh, liên kết phụ huynh–học sinh, khoá PIN theo loại thiết bị, consent (SPEC §2.2–2.3).

export type DeviceClass = 'trusted' | 'unknown';

/** Tính cho cả tài khoản: sai 5 lần → khoá 15 phút; sai 10 lần liên tiếp → khoá tới khi phụ huynh mở. */
export const PIN_SOFT_LOCK_AFTER = 5;
export const PIN_SOFT_LOCK_MINUTES = 15;
export const PIN_HARD_LOCK_AFTER = 10;

export interface LoginStudent {
  id: string;
  username: string;
  display_name: string;
  pin_hash: string;
  status: string;
  is_family: boolean;
}

// ───────────────────────── Luồng đăng nhập (chưa có phiên) ─────────────────────────

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function findStudentForLogin(username: string): Promise<LoginStudent | null> {
  return prisma.student.findUnique({
    where: { username: normalizeUsername(username) },
    select: { id: true, username: true, display_name: true, pin_hash: true, status: true, is_family: true },
  });
}

/** Học sinh ngoài gia đình phải có consent còn hiệu lực mới đăng nhập được (SPEC §2.3). */
export async function hasActiveConsent(studentId: string): Promise<boolean> {
  const consent = await prisma.consent.findFirst({
    where: { student_id: studentId, withdrawn_at: null },
    select: { id: true },
  });
  return consent !== null;
}

export interface PinLockState {
  failedCount: number;
  lockedUntil: Date | null;
  hardLocked: boolean;
}

/**
 * Trạng thái khoá của cả tài khoản (chủ dự án chốt 2026-10-21, đúng SPEC "khoá tài khoản học sinh"): sai PIN
 * từ thiết bị nào cũng cộng vào một bộ đếm; khoá cứng ở bất kỳ thiết bị nào là khoá cả tài khoản.
 */
export async function getPinLockState(studentId: string): Promise<PinLockState> {
  const [student, hard] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { pin_failed_count: true, pin_locked_until: true } }),
    prisma.pinLockout.findFirst({ where: { student_id: studentId, hard_locked: true }, select: { student_id: true } }),
  ]);
  return {
    failedCount: student?.pin_failed_count ?? 0,
    lockedUntil: student?.pin_locked_until ?? null,
    hardLocked: hard !== null,
  };
}

export type PinFailureOutcome = { failedCount: number; lock: 'none' | 'soft' | 'hard' };

/**
 * Tăng bộ đếm sai PIN của tài khoản atomic (UPDATE … + 1 RETURNING) và áp khoá theo ngưỡng. Dòng pin_lockouts
 * theo loại thiết bị chỉ để bố mẹ/admin thấy lần sai đến từ đâu.
 */
export async function registerPinFailure(studentId: string, deviceClass: DeviceClass): Promise<PinFailureOutcome> {
  await prisma.$executeRaw`
    INSERT INTO pin_lockouts (student_id, device_class, failed_count, updated_at)
    VALUES (${studentId}::uuid, ${deviceClass}, 1, now())
    ON CONFLICT (student_id, device_class)
    DO UPDATE SET failed_count = pin_lockouts.failed_count + 1, updated_at = now()`;
  const rows = await prisma.$queryRaw<{ pin_failed_count: number }[]>`
    UPDATE students SET pin_failed_count = pin_failed_count + 1 WHERE id = ${studentId}::uuid RETURNING pin_failed_count`;
  const failedCount = Number(rows[0]?.pin_failed_count ?? 0);

  if (failedCount >= PIN_HARD_LOCK_AFTER) {
    await prisma.pinLockout.update({
      where: { student_id_device_class: { student_id: studentId, device_class: deviceClass } },
      data: { hard_locked: true, locked_until: null },
    });
    return { failedCount, lock: 'hard' };
  }
  if (failedCount === PIN_SOFT_LOCK_AFTER) {
    const until = new Date(Date.now() + PIN_SOFT_LOCK_MINUTES * 60_000);
    await prisma.pinLockout.update({
      where: { student_id_device_class: { student_id: studentId, device_class: deviceClass } },
      data: { locked_until: until },
    });
    await prisma.student.update({ where: { id: studentId }, data: { pin_locked_until: until } });
    return { failedCount, lock: 'soft' };
  }
  return { failedCount, lock: 'none' };
}

/** Đăng nhập đúng: xoá bộ đếm của cả tài khoản (lần sai "liên tiếp" bắt đầu lại). */
export async function clearPinFailures(studentId: string): Promise<void> {
  await prisma.$transaction([
    prisma.pinLockout.deleteMany({ where: { student_id: studentId } }),
    prisma.student.update({ where: { id: studentId }, data: { pin_failed_count: 0, pin_locked_until: null } }),
  ]);
}

export async function isTrustedDevice(studentId: string, tokenHash: string): Promise<boolean> {
  const device = await prisma.trustedDevice.findUnique({ where: { token_hash: tokenHash } });
  if (!device || device.student_id !== studentId || device.revoked_at) return false;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { last_used_at: new Date() } });
  return true;
}

export async function addTrustedDevice(studentId: string, tokenHash: string): Promise<void> {
  await prisma.trustedDevice.create({ data: { student_id: studentId, token_hash: tokenHash } });
}

/** Phiên học sinh: kiểm hồ sơ còn dùng được. */
export async function findActiveStudent(studentId: string): Promise<{ id: string; display_name: string } | null> {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, display_name: true, status: true } });
  return s && s.status === 'active' ? { id: s.id, display_name: s.display_name } : null;
}

// ───────────────────────── Quản trị (container admin) ─────────────────────────

export interface NewStudentInput {
  username: string;
  displayName: string;
  gender: 'male' | 'female';
  pinHash: string;
  grade: number;
  preset: string;
  isFamily: boolean;
  interests: string[];
  companionName: string;
}

export async function createStudent(actor: Actor, input: NewStudentInput): Promise<string> {
  assertAdmin(actor);
  const username = normalizeUsername(input.username);
  // Tên đăng nhập không trùng tên gọi (khó đoán hơn, SPEC §2.2 bước 4).
  if (username === input.displayName.trim().toLowerCase()) {
    throw new Error('Tên đăng nhập không được trùng tên gọi của con');
  }
  const student = await prisma.student.create({
    data: {
      username,
      display_name: input.displayName.trim(),
      gender: input.gender,
      pin_hash: input.pinHash,
      created_by: actor.id,
      grade: input.grade,
      preset: input.preset,
      is_family: input.isFamily,
      interests_declared: input.interests,
      address: { tutor_self: input.companionName, student: input.displayName.trim() },
      companion: { name: input.companionName, avatar: 'owl_blue' },
      learning_prefs: { representation: 'visual', escalation_threshold: 2, session_minutes: 15, daily_limit_minutes: 30 },
    },
    select: { id: true },
  });
  await appendActorAccessLog(actor, { studentId: student.id, action: 'admin.create_student', resource: `students:${student.id}` });
  return student.id;
}

export async function listStudentsForAdmin(actor: Actor) {
  assertAdmin(actor);
  // Danh sách quản trị: không gồm dữ liệu học tập, chỉ thông tin tài khoản.
  return prisma.student.findMany({
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      username: true,
      display_name: true,
      grade: true,
      status: true,
      is_family: true,
      created_at: true,
      parent_links: { select: { parent_id: true } },
      pin_lockouts: { select: { device_class: true, failed_count: true, locked_until: true, hard_locked: true } },
      consents: { where: { withdrawn_at: null }, select: { id: true } },
    },
  });
}

export async function linkParentToStudent(actor: Actor, input: { parentId: string; studentId: string }): Promise<void> {
  assertAdmin(actor);
  const parent = await prisma.user.findUnique({ where: { id: input.parentId }, select: { role: true } });
  if (!parent) throw new Error('Không tìm thấy tài khoản phụ huynh');
  await prisma.parentStudent.upsert({
    where: { parent_id_student_id: { parent_id: input.parentId, student_id: input.studentId } },
    create: { parent_id: input.parentId, student_id: input.studentId },
    update: {},
  });
  await appendActorAccessLog(actor, {
    studentId: input.studentId,
    action: 'admin.link_parent',
    resource: `users:${input.parentId}`,
  });
}

export async function unlinkParentFromStudent(actor: Actor, input: { parentId: string; studentId: string }): Promise<void> {
  assertAdmin(actor);
  await prisma.parentStudent.deleteMany({ where: { parent_id: input.parentId, student_id: input.studentId } });
  await appendActorAccessLog(actor, {
    studentId: input.studentId,
    action: 'admin.unlink_parent',
    resource: `users:${input.parentId}`,
  });
}

export async function resetStudentPin(actor: Actor, input: { studentId: string; pinHash: string }): Promise<void> {
  assertAdmin(actor);
  await prisma.$transaction([
    prisma.student.update({
      where: { id: input.studentId },
      data: { pin_hash: input.pinHash, pin_failed_count: 0, pin_locked_until: null },
    }),
    prisma.pinLockout.deleteMany({ where: { student_id: input.studentId } }),
  ]);
  await appendActorAccessLog(actor, { studentId: input.studentId, action: 'admin.reset_pin', resource: `students:${input.studentId}` });
}

export async function setStudentStatus(
  actor: Actor,
  input: { studentId: string; status: 'active' | 'disabled' },
): Promise<void> {
  assertAdmin(actor);
  await prisma.student.update({ where: { id: input.studentId }, data: { status: input.status } });
  await appendActorAccessLog(actor, {
    studentId: input.studentId,
    action: `admin.set_student_status:${input.status}`,
    resource: `students:${input.studentId}`,
  });
}

export interface ConsentInput {
  studentId: string;
  parentId: string;
  version: string;
  textSnapshot: string;
  documentUri: string | null;
  childAcknowledged: boolean;
  signedAt: Date;
}

export async function recordConsent(actor: Actor, input: ConsentInput): Promise<string> {
  assertAdmin(actor);
  const consent = await prisma.consent.create({
    data: {
      student_id: input.studentId,
      parent_id: input.parentId,
      version: input.version,
      text_snapshot: input.textSnapshot,
      document_uri: input.documentUri,
      child_acknowledged: input.childAcknowledged,
      recorded_by: actor.id,
      signed_at: input.signedAt,
    },
    select: { id: true },
  });
  await appendActorAccessLog(actor, { studentId: input.studentId, action: 'admin.record_consent', resource: `consents:${consent.id}` });
  return consent.id;
}

// ───────────────────────── Phụ huynh liên kết hoặc admin ─────────────────────────

/** Mở khoá PIN (mọi loại thiết bị): phụ huynh liên kết hoặc admin. */
export async function unlockStudentPin(actor: Actor, input: { studentId: string }): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError();
  await assertStudentAccess(actor, input.studentId, { action: 'unlock_pin', resource: `students:${input.studentId}` });
  await prisma.$transaction([
    prisma.pinLockout.deleteMany({ where: { student_id: input.studentId } }),
    prisma.student.update({ where: { id: input.studentId }, data: { pin_failed_count: 0, pin_locked_until: null } }),
  ]);
}

/** Hồ sơ đầy đủ của một học sinh (phụ huynh liên kết, admin có lý do, hoặc chính em). */
export async function getStudentProfile(actor: Actor, input: { studentId: string }) {
  await assertStudentAccess(actor, input.studentId, {
    action: 'read',
    resource: 'students',
    log: actor.type !== 'student',
  });
  return prisma.student.findUniqueOrThrow({
    where: { id: input.studentId },
    omit: { pin_hash: true },
  });
}

/** Các con được liên kết với phụ huynh đang đăng nhập. */
export async function listLinkedStudents(actor: Actor) {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError();
  const links = await prisma.parentStudent.findMany({
    where: { parent_id: actor.id },
    select: { student: { select: { id: true, display_name: true, grade: true, status: true } } },
  });
  return links.map((l) => l.student);
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  normalizeUsername: { kind: 'no-actor', reason: 'hàm thuần' },
  findStudentForLogin: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  hasActiveConsent: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  getPinLockState: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  registerPinFailure: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  clearPinFailures: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh sau khi PIN đúng' },
  isTrustedDevice: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  addTrustedDevice: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh sau khi PIN đúng' },
  findActiveStudent: { kind: 'no-actor', reason: 'kiểm phiên học sinh' },
  createStudent: {
    kind: 'admin-only',
    call: (a) =>
      createStudent(a, {
        username: `fx-${Date.now()}`,
        displayName: 'Fixture',
        gender: 'male',
        pinHash: 'x',
        grade: 5,
        preset: 'grade5',
        isFamily: true,
        interests: [],
        companionName: 'Mít',
      }),
  },
  listStudentsForAdmin: { kind: 'admin-only', call: (a) => listStudentsForAdmin(a) },
  linkParentToStudent: {
    kind: 'admin-only',
    call: (a, c) => linkParentToStudent(a, { parentId: c.otherParentId, studentId: c.studentId }),
  },
  unlinkParentFromStudent: {
    kind: 'admin-only',
    call: (a, c) => unlinkParentFromStudent(a, { parentId: c.otherParentId, studentId: c.otherStudentId }),
  },
  resetStudentPin: { kind: 'admin-only', call: (a, c) => resetStudentPin(a, { studentId: c.studentId, pinHash: 'x' }) },
  setStudentStatus: {
    kind: 'admin-only',
    call: (a, c) => setStudentStatus(a, { studentId: c.studentId, status: 'active' }),
  },
  recordConsent: {
    kind: 'admin-only',
    call: (a, c) =>
      recordConsent(a, {
        studentId: c.studentId,
        parentId: c.linkedParentId,
        version: 'v1',
        textSnapshot: 'x',
        documentUri: null,
        childAcknowledged: false,
        signedAt: new Date(),
      }),
  },
  unlockStudentPin: { kind: 'student-scoped', call: (a, c) => unlockStudentPin(a, { studentId: c.studentId }) },
  getStudentProfile: { kind: 'student-scoped', call: (a, c) => getStudentProfile(a, { studentId: c.studentId }) },
  listLinkedStudents: { kind: 'self-account', call: (a) => listLinkedStudents(a) },
};
