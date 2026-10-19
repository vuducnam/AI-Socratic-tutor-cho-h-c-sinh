import 'server-only';
import { randomUUID } from 'node:crypto';
import { redis } from '@/server/auth/redis-client';

// Một lượt mỗi phiên tại một thời điểm (khoá Redis theo session_id) và idempotency theo mã do client
// sinh: gửi lại cùng mã → trả kết quả cũ, không tạo lượt mới (phase 12).

const LOCK_TTL_MS = 180_000;
const IDEMPOTENCY_TTL_S = 24 * 3600;

export class TurnBusyError extends Error {
  constructor() {
    super('Cú đang trả lời tin nhắn trước');
    this.name = 'TurnBusyError';
  }
}

export async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const key = `turnlock:${sessionId}`;
  const token = randomUUID();
  const acquired = await redis().set(key, token, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') throw new TurnBusyError();
  try {
    return await fn();
  } finally {
    // Chỉ xoá khoá của chính mình.
    await redis().eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }
}

const idemKey = (sessionId: string, key: string) => `idem:${sessionId}:${key}`;

export async function getIdempotentResult<T>(sessionId: string, key: string): Promise<T | null> {
  const raw = await redis().get(idemKey(sessionId, key));
  return raw ? (JSON.parse(raw) as T) : null;
}

/** Chỉ lưu id và trạng thái (không lưu nội dung hội thoại vào Redis). */
export async function saveIdempotentResult(sessionId: string, key: string, value: unknown): Promise<void> {
  await redis().set(idemKey(sessionId, key), JSON.stringify(value), 'EX', IDEMPOTENCY_TTL_S);
}
