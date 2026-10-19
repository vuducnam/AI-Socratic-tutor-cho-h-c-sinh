'use server';

import { redirect } from 'next/navigation';
import { requireParentActor } from '@/server/auth/session';
import type { ParentActor } from '@/server/dal/actor';
import { submitFrontierForm, submitPreviewForm, submitStaleReminderForm } from '@/server/domain/curriculum/progress-view';

// Phụ huynh liên kết đổi tiến độ của con. DAL kiểm liên kết; phụ huynh khác bị từ chối.
async function run(form: FormData, fn: (actor: ParentActor, form: FormData) => Promise<void>) {
  const actor = await requireParentActor();
  const studentId = String(form.get('studentId'));
  let error: string | null = null;
  try {
    await fn(actor, form);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Không lưu được';
  }
  redirect(`/parent/progress?studentId=${encodeURIComponent(studentId)}&${error ? `err=${encodeURIComponent(error)}` : 'ok=' + encodeURIComponent('Đã lưu')}`);
}

export async function parentSetFrontierAction(form: FormData) {
  await run(form, submitFrontierForm);
}
export async function parentPreviewAction(form: FormData) {
  await run(form, submitPreviewForm);
}
export async function parentStaleReminderAction(form: FormData) {
  await run(form, submitStaleReminderForm);
}
