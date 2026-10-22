import { endLearningSession, findIdleSessions } from '@/server/dal/sessions-dal';
import { enqueueSessionReport } from '@/server/jobs/enqueue-session-report';
import { systemActor } from '../actor';

// Phiên bỏ dở (phase 15): không hoạt động quá 30 phút → ended_at, end_reason = 'timeout', và báo cáo phiên.
export const CLOSE_IDLE_SESSIONS_JOB = 'close-idle-sessions';
export const IDLE_MINUTES = 30;

export async function runCloseIdleSessions(): Promise<{ closed: number }> {
  const actor = systemActor('đóng phiên bỏ dở');
  let closed = 0;
  for (const s of await findIdleSessions(actor, { minutes: IDLE_MINUTES })) {
    if (await endLearningSession(actor, { studentId: s.student_id, sessionId: s.id, reason: 'timeout' })) {
      await enqueueSessionReport({ studentId: s.student_id, sessionId: s.id });
      closed += 1;
    }
  }
  return { closed };
}
