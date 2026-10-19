import 'dotenv/config';
import { Queue, Worker, type Job } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '@/server/jobs/queues';
import { createRedisConnection } from '@/server/jobs/redis-connection';
import { FILE_DELETION_SWEEPER_JOB, runFileDeletionSweeper } from './jobs/file-deletion-sweeper';

// Process worker riêng (không chạy job trong route handler). Mỗi queue có một handler theo tên job.
type JobHandler = (job: Job) => Promise<unknown>;

const maintenanceHandlers: Record<string, JobHandler> = {
  [FILE_DELETION_SWEEPER_JOB]: () => runFileDeletionSweeper(),
};

// Job lặp định kỳ: id cố định nên khởi động lại worker không nhân đôi lịch.
const repeatingJobs: { name: string; everyMs: number }[] = [{ name: FILE_DELETION_SWEEPER_JOB, everyMs: 60_000 }];

const connection = createRedisConnection();
const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });

const maintenanceWorker = new Worker(
  QUEUE_NAMES.maintenance,
  async (job) => {
    const handler = maintenanceHandlers[job.name];
    if (!handler) throw new Error(`Không có handler cho job ${job.name}`);
    return handler(job);
  },
  { connection, concurrency: 2 },
);

maintenanceWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.name ?? '?'} (${job?.id ?? '?'}) lỗi: ${err.message}`);
});

async function main() {
  for (const { name, everyMs } of repeatingJobs) {
    await maintenanceQueue.upsertJobScheduler(name, { every: everyMs }, { name });
  }
  console.log(`[worker] sẵn sàng, queue: ${QUEUE_NAMES.maintenance}`);
}

async function shutdown() {
  await maintenanceWorker.close();
  await maintenanceQueue.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[worker] khởi động lỗi', err);
  process.exit(1);
});
