import 'dotenv/config';
import { Queue, Worker, type Job } from 'bullmq';
import { NOTIFY_PARENTS_JOB } from '@/server/jobs/enqueue-parent-notification';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from '@/server/jobs/queues';
import { createRedisConnection } from '@/server/jobs/redis-connection';
import { FILE_DELETION_SWEEPER_JOB, runFileDeletionSweeper } from './jobs/file-deletion-sweeper';
import { runNotifyParents } from './jobs/notify-parents';
import { PROGRESS_STALE_CHECK_JOB, runProgressStaleCheck } from './jobs/progress-stale-check';
import { CLOSE_IDLE_SESSIONS_JOB, runCloseIdleSessions } from './jobs/close-idle-sessions';
import { runSessionReport } from './jobs/session-report';
import { SESSION_REPORT_JOB } from '@/server/jobs/enqueue-session-report';

// Process worker riêng (không chạy job trong route handler). Mỗi queue có bảng handler theo tên job.
// Job chỉ mang id, không mang nội dung của con.
type JobHandler = (job: Job) => Promise<unknown>;

const handlers: Record<QueueName, Record<string, JobHandler>> = {
  [QUEUE_NAMES.maintenance]: {
    [FILE_DELETION_SWEEPER_JOB]: () => runFileDeletionSweeper(),
    [PROGRESS_STALE_CHECK_JOB]: () => runProgressStaleCheck(),
    [CLOSE_IDLE_SESSIONS_JOB]: () => runCloseIdleSessions(),
  },
  [QUEUE_NAMES.reports]: {
    [SESSION_REPORT_JOB]: (job) => runSessionReport(job.data as { studentId: string; sessionId: string }),
  },
  [QUEUE_NAMES.notifications]: {
    [NOTIFY_PARENTS_JOB]: (job) => runNotifyParents(job.data as { flagId: string }),
  },
};

// Job lặp định kỳ: id cố định nên khởi động lại worker không nhân đôi lịch.
const repeatingJobs: { queue: QueueName; name: string; everyMs: number }[] = [
  { queue: QUEUE_NAMES.maintenance, name: FILE_DELETION_SWEEPER_JOB, everyMs: 60_000 },
  { queue: QUEUE_NAMES.maintenance, name: PROGRESS_STALE_CHECK_JOB, everyMs: 6 * 3600_000 },
  { queue: QUEUE_NAMES.maintenance, name: CLOSE_IDLE_SESSIONS_JOB, everyMs: 5 * 60_000 },
];

/**
 * Mô tả lỗi cho log: lỗi mạng của Node (AggregateError khi mọi địa chỉ đều từ chối) có message rỗng, nên
 * kèm tên và mã lỗi (ECONNREFUSED…) để người vận hành biết nguyên nhân. Không in cấu hình hay dữ liệu.
 */
function describeError(err: Error): string {
  const code = (err as { code?: unknown }).code;
  const inner = err instanceof AggregateError ? err.errors.map((e: unknown) => (e as { code?: string }).code ?? String(e)).join(', ') : '';
  return [err.name, typeof code === 'string' ? code : '', err.message, inner ? `(${inner})` : ''].filter(Boolean).join(': ');
}

const connection = createRedisConnection();
const queues = new Map<QueueName, Queue>();
const workers: Worker[] = [];

for (const [queueName, table] of Object.entries(handlers) as [QueueName, Record<string, JobHandler>][]) {
  queues.set(queueName, new Queue(queueName, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }));
  const worker = new Worker(
    queueName,
    async (job) => {
      const handler = table[job.name];
      if (!handler) throw new Error(`Không có handler cho job ${job.name} trong ${queueName}`);
      return handler(job);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    console.error(`[worker] ${queueName}/${job?.name ?? '?'} (${job?.id ?? '?'}) lỗi: ${describeError(err)}`);
  });
  workers.push(worker);
}

async function main() {
  for (const { queue, name, everyMs } of repeatingJobs) {
    await queues.get(queue)!.upsertJobScheduler(name, { every: everyMs }, { name });
  }
  console.log(`[worker] sẵn sàng, queue: ${[...queues.keys()].join(', ')}`);
}

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[worker] khởi động lỗi', err);
  process.exit(1);
});
