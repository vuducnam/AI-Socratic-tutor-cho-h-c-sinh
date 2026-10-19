import 'server-only';
import { Redis } from 'ioredis';

// Kết nối Redis cho BullMQ (maxRetriesPerRequest phải là null với worker).
export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL chưa được đặt');
  return new Redis(url, { maxRetriesPerRequest: null });
}
