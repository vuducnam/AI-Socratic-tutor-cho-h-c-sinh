import { createFlag, listFlags } from '@/server/dal/flags-dal';
import { findStaleProgress } from '@/server/dal/school-progress-dal';
import { systemActor } from '../actor';

// Nhắc cập nhật tiến độ (SPEC §5c.2): tiến độ một môn không đổi quá 14 ngày (và còn bật nhắc) → cờ
// progress_stale trên /parent. Con vẫn học được với phạm vi cũ. Mỗi môn chỉ một cờ chưa xem tại một lúc.
export const PROGRESS_STALE_CHECK_JOB = 'progress-stale-check';
export const PROGRESS_STALE_DAYS = Number(process.env.PROGRESS_STALE_DAYS ?? '14');

export async function runProgressStaleCheck(): Promise<{ flagged: number }> {
  const actor = systemActor('kiểm tiến độ cũ');
  let flagged = 0;
  for (const p of await findStaleProgress(actor, { days: PROGRESS_STALE_DAYS })) {
    const open = await listFlags(actor, { studentId: p.student_id, onlyUnacknowledged: true });
    const already = open.some((f) => f.type === 'progress_stale' && (f.detail as { subject?: string } | null)?.subject === p.subject);
    if (already) continue;
    await createFlag(actor, {
      studentId: p.student_id,
      type: 'progress_stale',
      severity: 'info',
      detail: { subject: p.subject, last_set_at: p.set_at.toISOString(), days: PROGRESS_STALE_DAYS },
    });
    flagged += 1;
  }
  return { flagged };
}
