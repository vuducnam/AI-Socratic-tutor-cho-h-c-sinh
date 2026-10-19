'use server';

import { notFound, redirect } from 'next/navigation';
import { assertAdminRuntime, withAdminReason } from '@/server/auth/session';
import {
  reasonFromForm,
  submitFrontierForm,
  submitPreviewForm,
  submitStaleReminderForm,
} from '@/server/domain/curriculum/progress-view';

// Admin đặt tiến độ khi tạo hồ sơ. Admin không liên kết với học sinh phải ghi lý do (hiện cho phụ huynh).
async function adminWithReason(form: FormData) {
  try {
    return withAdminReason(await assertAdminRuntime(), reasonFromForm(form));
  } catch {
    notFound();
  }
}

async function run(form: FormData, fn: (actor: Awaited<ReturnType<typeof adminWithReason>>, form: FormData) => Promise<void>) {
  const actor = await adminWithReason(form);
  const studentId = String(form.get('studentId'));
  let error: string | null = null;
  try {
    await fn(actor, form);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Không lưu được';
  }
  redirect(`/admin/students/${studentId}/progress?${error ? `err=${encodeURIComponent(error)}` : 'ok=' + encodeURIComponent('Đã lưu')}`);
}

export async function adminSetFrontierAction(form: FormData) {
  await run(form, submitFrontierForm);
}
export async function adminPreviewAction(form: FormData) {
  await run(form, submitPreviewForm);
}
export async function adminStaleReminderAction(form: FormData) {
  await run(form, submitStaleReminderForm);
}
