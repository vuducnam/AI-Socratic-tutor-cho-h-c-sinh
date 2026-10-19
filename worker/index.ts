import 'dotenv/config';
import { Queue, Worker, type Job } from 'bullmq';
import { NOTIFY_PARENTS_JOB } from '@/server/jobs/enqueue-parent-notification';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from '@/server/jobs/queues';
import { createRedisConnection } from '@/server/jobs/redis-connection';
import { FILE_DELETION_SWEEPER_JOB, runFileDeletionSweeper } from './jobs/file-deletion-sweeper';
import { runNotifyParents } from './jobs/notify-parents';

// Process worker riêng (không chạy job trong route handler). Mỗi queue có bảng handler theo tên job.
// Job chỉ mang id, không mang nội dung của con.
type JobHandler = (job: Job) => Promise<unknown>;

const handlers: Record<QueueName, Record<string, JobHandler>> = {
  [QUEUE_NAMES.maintenance]: {
    [FILE_DELETION_SWEEPER_JOB]: () => runFileDeletionSweeper(),
  },
  [QUEUE_NAMES.notifications]: {
    [NOTIFY_PARENTS_JOB]: (job) => runNotifyParents(job.data as { flagId: string }),
  },
};

// Job lặp định kỳ: id cố định nên khởi động lại worker không nhân đôi lịch.
const repeatingJobs: { queue: QueueName; name: string; everyMs: number }[] = [
  { queue: QUEUE_NAMES.maintenance, name: FILE_DELETION_SWEEPER_JOB, everyMs: 60_000 },
];

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
    console.error(`[worker] ${queueName}/${job?.name ?? '?'} (${job?.id ?? '?'}) lỗi: ${err.message}`);
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
