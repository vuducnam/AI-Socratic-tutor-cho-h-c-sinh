import 'server-only';
import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queues';
import { createRedisConnection } from './redis-connection';

// Báo cáo phiên chạy trong worker (phase 17). Job chỉ mang id (phiên, học sinh), không mang nội dung;
// removeOnComplete/removeOnFail để Redis không giữ dữ liệu của con.
export const SESSION_REPORT_JOB = 'session-report';

let queue: Queue | undefined;
function reportsQueue(): Queue {
  queue ??= new Queue(QUEUE_NAMES.reports, { connection: createRedisConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
  return queue;
}

export async function enqueueSessionReport(input: { studentId: string; sessionId: string }): Promise<void> {
  await reportsQueue().add(SESSION_REPORT_JOB, input, { jobId: `report-${input.sessionId}` });
}
