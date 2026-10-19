import 'server-only';
import { z } from 'zod';
import type { Actor } from '@/server/dal/actor';
import { listLessons, loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { allowPreview, getSchoolProgress, revokePreview, setFrontier, setStaleReminder } from '@/server/dal/school-progress-dal';
import { getStudentContext } from '@/server/dal/sessions-dal';
import { computeScope } from './scope';

// Dữ liệu và thao tác của màn hình tiến độ, dùng chung cho /admin và /parent.

export async function loadProgressView(actor: Actor, input: { studentId: string; subject: string }) {
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const [lessons, progress, catalog] = await Promise.all([
    listLessons(input.subject, student.grade),
    getSchoolProgress(actor, input),
    loadScopeCatalog(input.subject, student.grade),
  ]);
  const scope = progress
    ? computeScope({
        subject: input.subject,
        grade: student.grade,
        ...catalog,
        progress: { frontierLessonId: progress.frontier_lesson_id, previewLessonIds: progress.preview_lesson_ids },
      })
    : null;
  return {
    student,
    lessons: lessons.map((l) => ({ ...l, topic: l.topic ?? '' })),
    frontierLessonId: progress?.frontier_lesson_id ?? null,
    previewLessonIds: scope?.previewLessonIds ?? [],
    staleReminderEnabled: progress?.stale_reminder_enabled ?? true,
    scope,
  };
}

const base = z.object({ studentId: z.uuid(), subject: z.string().min(1).max(40) });

export async function submitFrontierForm(actor: Actor, form: FormData): Promise<void> {
  const data = base.extend({ lessonId: z.string().min(1) }).parse(Object.fromEntries(form));
  await setFrontier(actor, data);
}

export async function submitPreviewForm(actor: Actor, form: FormData): Promise<void> {
  const data = base.extend({ lessonId: z.string().min(1), allow: z.enum(['true', 'false']) }).parse(Object.fromEntries(form));
  if (data.allow === 'true') await allowPreview(actor, data);
  else await revokePreview(actor, data);
}

export async function submitStaleReminderForm(actor: Actor, form: FormData): Promise<void> {
  const data = base.extend({ enabled: z.enum(['true', 'false']) }).parse(Object.fromEntries(form));
  await setStaleReminder(actor, { ...data, enabled: data.enabled === 'true' });
}

export function reasonFromForm(form: FormData): string {
  return z.string().trim().min(3).max(300).parse(form.get('reason'));
}
