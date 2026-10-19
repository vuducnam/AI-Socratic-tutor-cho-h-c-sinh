import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { setFrontier } from './school-progress-dal';

// Gợi ý cập nhật tiến độ từ bài về nhà (SPEC §5c.2, §5c.5). Không bao giờ tự dời frontier: phụ huynh
// đồng ý thì mới đổi (via = 'suggestion'), vì việc map đề vào bài do LLM làm và có thể sai.

export async function createProgressSuggestion(
  actor: Actor,
  input: { studentId: string; subject: string; lessonId: string; evidenceProblemId: string },
): Promise<string> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'progress_suggestions', log: actor.type !== 'student' });
  const existing = await prisma.progressSuggestion.findFirst({
    where: { student_id: input.studentId, subject: input.subject, lesson_id: input.lessonId, status: 'pending' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const row = await prisma.progressSuggestion.create({
    data: {
      student_id: input.studentId,
      subject: input.subject,
      lesson_id: input.lessonId,
      evidence_problem_id: input.evidenceProblemId,
    },
    select: { id: true },
  });
  return row.id;
}

export async function listProgressSuggestions(actor: Actor, input: { studentId: string; onlyPending?: boolean }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'progress_suggestions' });
  return prisma.progressSuggestion.findMany({
    where: { student_id: input.studentId, ...(input.onlyPending ? { status: 'pending' } : {}) },
    include: { lesson: { select: { title: true, book: true, lesson_no: true } }, evidence_problem: { select: { confirmed_text: true } } },
    orderBy: { created_at: 'desc' },
  });
}

export async function decideProgressSuggestion(
  actor: Actor,
  input: { studentId: string; suggestionId: string; accept: boolean },
): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh quyết định tiến độ');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'progress_suggestions' });
  const s = await prisma.progressSuggestion.findUnique({ where: { id: input.suggestionId } });
  if (!s || s.student_id !== input.studentId) throw new AuthorizationError('Không có gợi ý này');
  if (s.status !== 'pending') throw new Error('Gợi ý đã được quyết định');
  if (input.accept) {
    await setFrontier(actor, { studentId: s.student_id, subject: s.subject, lessonId: s.lesson_id, via: 'suggestion', suggestionId: s.id });
  }
  await prisma.progressSuggestion.update({
    where: { id: s.id },
    data: { status: input.accept ? 'accepted' : 'rejected', decided_by: actor.id, decided_at: new Date() },
  });
}

const FAKE = '00000000-0000-0000-0000-000000000001';
export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  createProgressSuggestion: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => createProgressSuggestion(a, { studentId: c.studentId, subject: 'test-math', lessonId: 'TEST5.T1.B1', evidenceProblemId: FAKE }),
  },
  listProgressSuggestions: { kind: 'student-scoped', call: (a, c) => listProgressSuggestions(a, { studentId: c.studentId }) },
  decideProgressSuggestion: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => decideProgressSuggestion(a, { studentId: c.studentId, suggestionId: FAKE, accept: false }),
  },
};
