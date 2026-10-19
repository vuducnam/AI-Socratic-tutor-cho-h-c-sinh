import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { createFlag } from '@/server/dal/flags-dal';
import { getSchoolProgress } from '@/server/dal/school-progress-dal';
import { createLearningSession, getStudentContext } from '@/server/dal/sessions-dal';
import { computeScope, type CurriculumScope } from '@/server/domain/curriculum/scope';

// Mở phiên (SPEC §6 bước 0, §5c.2): chưa đặt tiến độ cho môn → không mở phiên, cờ progress_missing.
// Có tiến độ → computeScope một lần, lưu sessions.scope_snapshot (cố định trong phiên).

export const PROGRESS_MISSING_MESSAGE = 'Bố mẹ cần cho Cú biết trên lớp con học tới bài nào đã.';

export type OpenSessionResult =
  | { ok: true; sessionId: string; scope: CurriculumScope }
  | { ok: false; reason: 'progress_missing'; message: string };

export async function openLearningSession(
  actor: Actor,
  input: { studentId: string; subject: string; mode?: 'solve' | 'argue'; openedVia?: 'student' | 'reminder' },
): Promise<OpenSessionResult> {
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const progress = await getSchoolProgress(actor, { studentId: input.studentId, subject: input.subject });
  if (!progress?.frontier_lesson_id && !(progress?.preview_lesson_ids.length)) {
    await createFlag(actor, {
      studentId: input.studentId,
      type: 'progress_missing',
      severity: 'warning',
      detail: { subject: input.subject },
    });
    return { ok: false, reason: 'progress_missing', message: PROGRESS_MISSING_MESSAGE };
  }
  const catalog = await loadScopeCatalog(input.subject, student.grade);
  const scope = computeScope({
    subject: input.subject,
    grade: student.grade,
    ...catalog,
    progress: { frontierLessonId: progress.frontier_lesson_id, previewLessonIds: progress.preview_lesson_ids },
  });
  const sessionId = await createLearningSession(actor, {
    studentId: input.studentId,
    subject: input.subject,
    mode: input.mode ?? 'solve',
    scope,
    openedVia: input.openedVia,
  });
  return { ok: true, sessionId, scope };
}
