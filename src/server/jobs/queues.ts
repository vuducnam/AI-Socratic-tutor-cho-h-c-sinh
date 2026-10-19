import 'server-only';

// Tên queue BullMQ dùng chung giữa nơi enqueue (src/server/jobs) và worker. Job chỉ mang id,
// không mang nội dung của con, để Redis không giữ dữ liệu học sinh.
export const QUEUE_NAMES = {
  maintenance: 'cu-maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 3600 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;
