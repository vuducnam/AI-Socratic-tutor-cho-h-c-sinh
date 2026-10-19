import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertAdmin, assertSystem } from './role-guards';

// Tiến độ trên lớp (SPEC §5c.2): một con trỏ "đã học đến bài X" mỗi môn + danh sách học trước.
// Chỉ phụ huynh liên kết (hoặc admin) đổi được; mọi thay đổi ghi school_progress_events [AO].

type ChangeVia = 'parent' | 'admin' | 'suggestion';

function assertCanChangeProgress(actor: Actor): asserts actor is Actor<'parent' | 'admin'> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh mới đổi được tiến độ');
}

function viaFor(actor: Actor, via?: ChangeVia): ChangeVia {
  return via ?? (actor.type === 'admin' ? 'admin' : 'parent');
}

async function lessonOfStudentGrade(studentId: string, subject: string, lessonId: string) {
  const [student, lesson] = await Promise.all([
    prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { grade: true } }),
    prisma.curriculumLesson.findUnique({ where: { lesson_id: lessonId } }),
  ]);
  if (!lesson || lesson.subject !== subject || lesson.grade !== student.grade || lesson.seq <= 0) {
    throw new Error('Bài không thuộc mục lục lớp hiện tại của con');
  }
  return lesson;
}

export async function getSchoolProgress(actor: Actor, input: { studentId: string; subject: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'school_progress', log: actor.type !== 'student' });
  return prisma.schoolProgress.findUnique({ where: { student_id_subject: { student_id: input.studentId, subject: input.subject } } });
}

export async function listSchoolProgress(actor: Actor, input: { studentId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'school_progress', log: actor.type !== 'student' });
  return prisma.schoolProgress.findMany({
    where: { student_id: input.studentId },
    include: { frontier: { select: { lesson_id: true, title: true, book: true, seq: true } } },
  });
}

export async function setFrontier(
  actor: Actor,
  input: { studentId: string; subject: string; lessonId: string; via?: ChangeVia; suggestionId?: string },
): Promise<void> {
  assertCanChangeProgress(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'school_progress' });
  const lesson = await lessonOfStudentGrade(input.studentId, input.subject, input.lessonId);
  const existing = await prisma.schoolProgress.findUnique({
    where: { student_id_subject: { student_id: input.studentId, subject: input.subject } },
  });
  // Bài học trước đã nằm trong phần đã học thì rời khỏi danh sách preview.
  const previewLessons = existing?.preview_lesson_ids.length
    ? await prisma.curriculumLesson.findMany({ where: { lesson_id: { in: existing.preview_lesson_ids } }, select: { lesson_id: true, seq: true } })
    : [];
  const preview = previewLessons.filter((p) => p.seq > lesson.seq).map((p) => p.lesson_id);
  await prisma.$transaction([
    prisma.schoolProgress.upsert({
      where: { student_id_subject: { student_id: input.studentId, subject: input.subject } },
      create: { student_id: input.studentId, subject: input.subject, frontier_lesson_id: lesson.lesson_id, set_by: actor.id },
      update: { frontier_lesson_id: lesson.lesson_id, preview_lesson_ids: preview, set_by: actor.id, set_at: new Date() },
    }),
    prisma.schoolProgressEvent.create({
      data: {
        student_id: input.studentId,
        subject: input.subject,
        action: 'set_frontier',
        lesson_id: lesson.lesson_id,
        via: viaFor(actor, input.via),
        suggestion_id: input.suggestionId ?? null,
        actor_id: actor.id,
      },
    }),
  ]);
}

async function changePreview(actor: Actor, input: { studentId: string; subject: string; lessonId: string }, allow: boolean) {
  assertCanChangeProgress(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'school_progress' });
  const lesson = await lessonOfStudentGrade(input.studentId, input.subject, input.lessonId);
  const progress = await prisma.schoolProgress.findUnique({
    where: { student_id_subject: { student_id: input.studentId, subject: input.subject } },
    include: { frontier: { select: { seq: true } } },
  });
  if (!progress?.frontier) throw new Error('Đặt "con đã học đến bài…" trước khi cho học trước');
  if (allow && lesson.seq <= progress.frontier.seq) throw new Error('Bài này con đã học rồi');
  const ids = new Set(progress.preview_lesson_ids);
  if (allow) ids.add(lesson.lesson_id);
  else ids.delete(lesson.lesson_id);
  await prisma.$transaction([
    prisma.schoolProgress.update({
      where: { student_id_subject: { student_id: input.studentId, subject: input.subject } },
      data: { preview_lesson_ids: [...ids], set_by: actor.id },
    }),
    prisma.schoolProgressEvent.create({
      data: {
        student_id: input.studentId,
        subject: input.subject,
        action: allow ? 'allow_preview' : 'revoke_preview',
        lesson_id: lesson.lesson_id,
        via: viaFor(actor),
        actor_id: actor.id,
      },
    }),
  ]);
}

export async function allowPreview(actor: Actor, input: { studentId: string; subject: string; lessonId: string }) {
  await changePreview(actor, input, true);
}

export async function revokePreview(actor: Actor, input: { studentId: string; subject: string; lessonId: string }) {
  await changePreview(actor, input, false);
}

/** Tắt/bật nhắc cập nhật tiến độ (vd. nghỉ hè). */
export async function setStaleReminder(actor: Actor, input: { studentId: string; subject: string; enabled: boolean }) {
  assertCanChangeProgress(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'school_progress' });
  await prisma.$transaction([
    prisma.schoolProgress.update({
      where: { student_id_subject: { student_id: input.studentId, subject: input.subject } },
      data: { stale_reminder_enabled: input.enabled },
    }),
    prisma.schoolProgressEvent.create({
      data: {
        student_id: input.studentId,
        subject: input.subject,
        action: 'set_stale_reminder',
        via: viaFor(actor),
        actor_id: actor.id,
        detail: { enabled: input.enabled },
      },
    }),
  ]);
}

export async function listProgressEvents(actor: Actor, input: { studentId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'school_progress_events' });
  return prisma.schoolProgressEvent.findMany({ where: { student_id: input.studentId }, orderBy: { created_at: 'desc' }, take: 200 });
}

/** Lên lớp: mọi bài lớp cũ coi là đã học (computeScope), tiến độ lớp mới bắt đầu rỗng. */
export async function promoteGrade(actor: Actor, input: { studentId: string }) {
  assertAdmin(actor);
  const student = await prisma.student.findUniqueOrThrow({ where: { id: input.studentId }, select: { grade: true } });
  const subjects = await prisma.schoolProgress.findMany({ where: { student_id: input.studentId }, select: { subject: true } });
  await prisma.$transaction([
    prisma.student.update({ where: { id: input.studentId }, data: { grade: student.grade + 1 } }),
    prisma.schoolProgress.deleteMany({ where: { student_id: input.studentId } }),
    ...subjects.map((s) =>
      prisma.schoolProgressEvent.create({
        data: {
          student_id: input.studentId,
          subject: s.subject,
          action: 'grade_up',
          via: 'admin',
          actor_id: actor.id,
          detail: { from: student.grade, to: student.grade + 1 },
        },
      }),
    ),
  ]);
}

/** Worker: tiến độ không đổi quá `days` ngày và còn bật nhắc. */
export async function findStaleProgress(actor: Actor, input: { days: number }) {
  assertSystem(actor);
  const cutoff = new Date(Date.now() - input.days * 24 * 3600_000);
  return prisma.schoolProgress.findMany({
    where: { stale_reminder_enabled: true, set_at: { lt: cutoff } },
    select: { student_id: true, subject: true, set_at: true },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  getSchoolProgress: { kind: 'student-scoped', call: (a, c) => getSchoolProgress(a, { studentId: c.studentId, subject: 'math' }) },
  listSchoolProgress: { kind: 'student-scoped', call: (a, c) => listSchoolProgress(a, { studentId: c.studentId }) },
  setFrontier: {
    kind: 'student-scoped',
    call: (a, c) => setFrontier(a, { studentId: c.studentId, subject: 'test-math', lessonId: 'TEST5.T1.B1' }),
  },
  allowPreview: {
    kind: 'student-scoped',
    call: (a, c) => allowPreview(a, { studentId: c.studentId, subject: 'test-math', lessonId: 'TEST5.T1.B1' }),
  },
  revokePreview: {
    kind: 'student-scoped',
    call: (a, c) => revokePreview(a, { studentId: c.studentId, subject: 'test-math', lessonId: 'TEST5.T1.B1' }),
  },
  setStaleReminder: {
    kind: 'student-scoped',
    call: (a, c) => setStaleReminder(a, { studentId: c.studentId, subject: 'test-math', enabled: true }),
  },
  listProgressEvents: { kind: 'student-scoped', call: (a, c) => listProgressEvents(a, { studentId: c.studentId }) },
  promoteGrade: { kind: 'admin-only', call: (a, c) => promoteGrade(a, { studentId: c.otherStudentId }) },
  findStaleProgress: { kind: 'system-only', call: (a) => findStaleProgress(a, { days: 14 }) },
};
