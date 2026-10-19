import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES } from '@/server/jobs/queues';
import { createRedisConnection } from '@/server/jobs/redis-connection';

// Process worker riêng (không chạy job trong route handler). Mỗi queue có một handler theo tên job.
type JobHandler = (job: Job) => Promise<void>;
const maintenanceHandlers: Record<string, JobHandler> = {};

const connection = createRedisConnection();

const maintenanceWorker = new Worker(
  QUEUE_NAMES.maintenance,
  async (job) => {
    const handler = maintenanceHandlers[job.name];
    if (!handler) throw new Error(`Không có handler cho job ${job.name}`);
    await handler(job);
  },
  { connection, concurrency: 2 },
);

maintenanceWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.name ?? '?'} (${job?.id ?? '?'}) lỗi: ${err.message}`);
});

console.log(`[worker] đã kết nối Redis, lắng nghe queue: ${QUEUE_NAMES.maintenance}`);

async function shutdown() {
  await maintenanceWorker.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
