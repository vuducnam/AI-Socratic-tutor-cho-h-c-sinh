import 'server-only';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertSystem } from './role-guards';

// Phiên học. scope_snapshot tính một lần lúc mở phiên và cố định trong phiên (SPEC §5c.3).

export interface StudentContext {
  id: string;
  display_name: string;
  gender: string;
  grade: number;
  preset: string;
  address: unknown;
  companion: unknown;
  interests_declared: string[];
  learning_prefs: unknown;
}

/** Hồ sơ dùng để dựng prompt: chỉ trường được phép gửi ra ngoài (quy tắc cứng 10). */
export async function getStudentContext(actor: Actor, input: { studentId: string }): Promise<StudentContext> {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'students', log: actor.type !== 'student' });
  return prisma.student.findUniqueOrThrow({
    where: { id: input.studentId },
    select: {
      id: true,
      display_name: true,
      gender: true,
      grade: true,
      preset: true,
      address: true,
      companion: true,
      interests_declared: true,
      learning_prefs: true,
    },
  });
}

export async function createLearningSession(
  actor: Actor,
  input: { studentId: string; subject: string; mode: 'solve' | 'argue'; scope: CurriculumScope; openedVia?: 'student' | 'reminder' },
): Promise<string> {
  if (actor.type !== 'student' && actor.type !== 'system') throw new AuthorizationError('Chỉ học sinh mở phiên học');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'sessions', log: actor.type !== 'student' });
  const s = await prisma.session.create({
    data: {
      student_id: input.studentId,
      subject: input.subject,
      mode: input.mode,
      scope_snapshot: input.scope as unknown as object,
      opened_via: input.openedVia ?? 'student',
    },
    select: { id: true },
  });
  return s.id;
}

export async function getLearningSession(actor: Actor, input: { studentId: string; sessionId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'sessions', log: actor.type !== 'student' });
  const s = await prisma.session.findFirst({ where: { id: input.sessionId, student_id: input.studentId } });
  if (!s) throw new AuthorizationError('Không có phiên này');
  return { ...s, scope_snapshot: s.scope_snapshot as unknown as CurriculumScope };
}

/** Phiên đang mở gần nhất của học sinh cho môn (để tiếp tục thay vì mở phiên mới). */
export async function findOpenSession(actor: Actor, input: { studentId: string; subject: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'sessions', log: actor.type !== 'student' });
  return prisma.session.findFirst({
    where: { student_id: input.studentId, subject: input.subject, ended_at: null },
    orderBy: { started_at: 'desc' },
    select: { id: true, started_at: true },
  });
}

export async function touchSession(actor: Actor, input: { studentId: string; sessionId: string }): Promise<void> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'sessions', log: actor.type !== 'student' });
  await prisma.session.updateMany({ where: { id: input.sessionId, student_id: input.studentId }, data: { last_activity_at: new Date() } });
}

export async function endLearningSession(
  actor: Actor,
  input: { studentId: string; sessionId: string; reason: string },
): Promise<boolean> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'sessions', log: actor.type !== 'student' });
  const r = await prisma.session.updateMany({
    where: { id: input.sessionId, student_id: input.studentId, ended_at: null },
    data: { ended_at: new Date(), end_reason: input.reason },
  });
  return r.count > 0;
}

/** Worker: phiên không hoạt động quá `minutes` phút. */
export async function findIdleSessions(actor: Actor, input: { minutes: number }) {
  assertSystem(actor);
  return prisma.session.findMany({
    where: { ended_at: null, last_activity_at: { lt: new Date(Date.now() - input.minutes * 60_000) } },
    select: { id: true, student_id: true },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  getStudentContext: { kind: 'student-scoped', call: (a, c) => getStudentContext(a, { studentId: c.studentId }) },
  createLearningSession: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) =>
      createLearningSession(a, { studentId: c.studentId, subject: 'test-math', mode: 'solve', scope: {} as CurriculumScope }),
  },
  getLearningSession: { kind: 'student-scoped', call: (a, c) => getLearningSession(a, { studentId: c.studentId, sessionId: c.sessionId }) },
  findOpenSession: { kind: 'student-scoped', call: (a, c) => findOpenSession(a, { studentId: c.studentId, subject: 'test-math' }) },
  touchSession: { kind: 'student-scoped', call: (a, c) => touchSession(a, { studentId: c.studentId, sessionId: c.sessionId }) },
  endLearningSession: {
    kind: 'student-scoped',
    call: (a, c) => endLearningSession(a, { studentId: c.studentId, sessionId: '00000000-0000-0000-0000-000000000001', reason: 'fixture' }),
  },
  findIdleSessions: { kind: 'system-only', call: (a) => findIdleSessions(a, { minutes: 30 }) },
};
