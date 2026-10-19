'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireParentActor } from '@/server/auth/session';
import { revokeAllSessions } from '@/server/auth/session-store';
import { purgeStudentData } from '@/server/dal/parent-data-dal';
import { errorMessage, noticeUrl } from '../_lib/parent-page-helpers';

const purgeForm = z.object({
  studentId: z.uuid(),
  confirmDisplayName: z.string().max(200),
  reason: z.string().max(500).optional(),
  understood: z.literal('yes', { error: 'Cần đánh dấu đã hiểu' }),
});

// Bước 2/2 của xoá dữ liệu: DAL kiểm liên kết và tên gọi, tạo purge_requests và gọi purge_student().
// Sau khi xoá, thu hồi mọi phiên đăng nhập của con.
export async function purgeStudentAction(form: FormData) {
  const actor = await requireParentActor();
  const parsed = purgeForm.safeParse({
    studentId: form.get('studentId'),
    confirmDisplayName: form.get('confirmDisplayName') ?? '',
    reason: form.get('reason') ?? undefined,
    understood: form.get('understood'),
  });
  if (!parsed.success) {
    const studentId = typeof form.get('studentId') === 'string' ? String(form.get('studentId')) : '';
    redirect(noticeUrl('/parent/data/purge/confirm', { err: parsed.error.issues[0]?.message ?? 'Chưa xác nhận đủ' }, { studentId }));
  }
  const { studentId, confirmDisplayName, reason } = parsed.data;
  let error: string | null = null;
  try {
    await purgeStudentData(actor, { studentId, confirmDisplayName, reason });
  } catch (err) {
    error = errorMessage(err, 'Chưa xoá được, thử lại sau');
  }
  if (error) redirect(noticeUrl('/parent/data/purge/confirm', { err: error }, { studentId }));

  try {
    await revokeAllSessions('student', studentId);
  } catch (err) {
    // Hồ sơ đã bị xoá nên phiên cũ không còn dùng được (findActiveStudent trả null); chỉ ghi lỗi.
    console.error('[purge] không thu hồi được phiên học sinh', err);
  }
  redirect(noticeUrl('/parent', { ok: 'Đã xoá toàn bộ dữ liệu của con' }));
}
