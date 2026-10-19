import 'server-only';
import { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queues';
import { createRedisConnection } from './redis-connection';

// Báo phụ huynh "có việc cần xem" (cờ an toàn severity cao, khoá PIN). Job chỉ mang flagId.
export const NOTIFY_PARENTS_JOB = 'notify-parents';

let queue: Queue | undefined;
function notificationsQueue(): Queue {
  queue ??= new Queue(QUEUE_NAMES.notifications, {
    connection: createRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return queue;
}

export async function enqueueParentNotification(flagId: string): Promise<void> {
  await notificationsQueue().add(NOTIFY_PARENTS_JOB, { flagId }, { jobId: `notify-${flagId}` });
}
