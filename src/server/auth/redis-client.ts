import 'server-only';
import type { Redis } from 'ioredis';
import { createRedisConnection } from '@/server/jobs/redis-connection';

// Một kết nối Redis dùng chung cho phiên đăng nhập, rate limit, khoá lượt chat (không dùng cho BullMQ worker).
const globalForRedis = globalThis as unknown as { cuRedis?: Redis };

export function redis(): Redis {
  globalForRedis.cuRedis ??= createRedisConnection();
  return globalForRedis.cuRedis;
}
