import 'server-only';
import { randomUUID } from 'node:crypto';
import { redis } from '@/server/auth/redis-client';

// Mở/tiếp tục phiên tuần tự theo từng học sinh. Hai lần gọi /api/learn/start cùng lúc (bấm hai lần, tải lại
// trang, hai tab) từng tạo ra hai phiên: phiên rỗng còn mở, hiện trong trang bố mẹ và sinh báo cáo rỗng.
// Lần gọi sau chờ lần trước xong rồi mới chạy, nên thấy phiên vừa mở và tiếp tục đúng phiên đó.

const LOCK_TTL_MS = 30_000;
const WAIT_MS = 10_000;
const POLL_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withStudentStartLock<T>(studentId: string, fn: () => Promise<T>, waitMs = WAIT_MS): Promise<T> {
  const key = `startlock:${studentId}`;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  let acquired = false;
  while (!acquired) {
    acquired = (await redis().set(key, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
    // Chờ quá lâu (lần trước treo): vẫn chạy, khoá tự hết hạn sau LOCK_TTL_MS.
    if (!acquired && Date.now() >= deadline) break;
    if (!acquired) await sleep(POLL_MS);
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      // Chỉ xoá khoá của chính mình.
      await redis().eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
    }
  }
}
