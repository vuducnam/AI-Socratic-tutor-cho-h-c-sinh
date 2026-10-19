'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { acknowledgeFlag } from '@/server/dal/flags-dal';
import { errorMessage, noticeUrl } from '../_lib/parent-page-helpers';

const schema = z.object({ studentId: z.uuid(), flagId: z.uuid() });

// Phụ huynh liên kết đánh dấu đã xem một cờ. DAL kiểm liên kết; phụ huynh khác bị từ chối.
export async function acknowledgeFlagAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = schema.safeParse({ studentId: form.get('studentId'), flagId: form.get('flagId') });
  if (!parsed.success) redirect(noticeUrl('/parent/flags', { err: 'Yêu cầu không hợp lệ' }));
  let error: string | null = null;
  try {
    await acknowledgeFlag(actor, parsed.data);
  } catch (err) {
    error = errorMessage(err, 'Không lưu được');
  }
  redirect(noticeUrl('/parent/flags', error ? { err: error } : { ok: 'Đã đánh dấu đã xem' }, { studentId: parsed.data.studentId }));
}
