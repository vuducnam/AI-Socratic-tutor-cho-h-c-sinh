import { buildSessionReport } from '@/server/domain/report/build-session-report';
import { systemActor } from '../actor';

// Báo cáo phiên chạy trong worker khi phiên đóng (kể cả đóng do timeout).
export async function runSessionReport(data: { studentId: string; sessionId: string }): Promise<{ reportId: string }> {
  return { reportId: await buildSessionReport(systemActor('báo cáo phiên'), data) };
}
