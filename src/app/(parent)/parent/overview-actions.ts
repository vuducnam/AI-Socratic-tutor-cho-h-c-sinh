'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { acknowledgeSystemAlert } from '@/server/dal/system-alerts-dal';
import { errorMessage, noticeUrl } from './_lib/parent-page-helpers';

// Phụ huynh đánh dấu đã xem một cảnh báo hệ thống (không phải dữ liệu học sinh).
export async function acknowledgeSystemAlertAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = z.object({ alertId: z.uuid() }).safeParse({ alertId: form.get('alertId') });
  let error: string | null = null;
  if (!parsed.success) error = 'Cảnh báo không hợp lệ';
  else {
    try {
      await acknowledgeSystemAlert(actor, { alertId: parsed.data.alertId });
    } catch (err) {
      error = errorMessage(err, 'Không lưu được');
    }
  }
  redirect(noticeUrl('/parent', error ? { err: error } : { ok: 'Đã đánh dấu đã xem' }));
}
