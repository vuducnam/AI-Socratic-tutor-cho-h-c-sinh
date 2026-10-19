import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { redis } from './redis-client';

// Phiên lưu phía server (Redis); cookie chỉ chứa id ngẫu nhiên kèm chữ ký HMAC. Thu hồi được theo người
// dùng/học sinh khi khoá tài khoản, disable, đổi/reset mật khẩu hoặc PIN (phase 04).

export type SessionKind = 'admin' | 'parent' | 'student';

export interface SessionRecord {
  id: string;
  kind: SessionKind;
  subjectId: string;
  createdAt: number;
  lastSeenAt: number;
  /** Mốc hết hạn tuyệt đối (ms), ví dụ phiên học sinh hết khi sang ngày mới. */
  absoluteExpiresAt: number | null;
}

/** Phiên hết hạn sau 12 giờ không hoạt động (SPEC §2.2). */
export const IDLE_TIMEOUT_SECONDS = 12 * 3600;

const sessionKey = (id: string) => `sess:${id}`;
const indexKey = (kind: SessionKind, subjectId: string) => `sessidx:${kind}:${subjectId}`;

function secretFor(kind: SessionKind): string {
  const secret = kind === 'admin' ? process.env.ADMIN_SESSION_SECRET : process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(kind === 'admin' ? 'ADMIN_SESSION_SECRET chưa đặt' : 'SESSION_SECRET chưa đặt');
  }
  return secret;
}

function sign(kind: SessionKind, id: string): string {
  return createHmac('sha256', secretFor(kind)).update(id).digest('base64url');
}

export function encodeSessionCookie(kind: SessionKind, id: string): string {
  return `${id}.${sign(kind, id)}`;
}

export function decodeSessionCookie(kind: SessionKind, value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(kind, id));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export async function createSession(
  kind: SessionKind,
  subjectId: string,
  options: { absoluteExpiresAt?: number | null } = {},
): Promise<SessionRecord> {
  const now = Date.now();
  const record: SessionRecord = {
    id: randomBytes(32).toString('base64url'),
    kind,
    subjectId,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: options.absoluteExpiresAt ?? null,
  };
  await redis()
    .multi()
    .set(sessionKey(record.id), JSON.stringify(record), 'EX', IDLE_TIMEOUT_SECONDS)
    .sadd(indexKey(kind, subjectId), record.id)
    .expire(indexKey(kind, subjectId), IDLE_TIMEOUT_SECONDS * 2)
    .exec();
  return record;
}

/** Đọc phiên và gia hạn idle timeout. Trả null nếu không có, sai loại hoặc đã quá hạn tuyệt đối. */
export async function loadSession(kind: SessionKind | SessionKind[], id: string): Promise<SessionRecord | null> {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const raw = await redis().get(sessionKey(id));
  if (!raw) return null;
  const record = JSON.parse(raw) as SessionRecord;
  if (!kinds.includes(record.kind)) return null;
  const now = Date.now();
  if (record.absoluteExpiresAt !== null && now >= record.absoluteExpiresAt) {
    await destroySession(id);
    return null;
  }
  record.lastSeenAt = now;
  await redis().set(sessionKey(id), JSON.stringify(record), 'EX', IDLE_TIMEOUT_SECONDS);
  return record;
}

export async function destroySession(id: string): Promise<void> {
  const raw = await redis().get(sessionKey(id));
  if (raw) {
    const record = JSON.parse(raw) as SessionRecord;
    await redis().srem(indexKey(record.kind, record.subjectId), id);
  }
  await redis().del(sessionKey(id));
}

/** Thu hồi mọi phiên của một người dùng/học sinh. */
export async function revokeAllSessions(kind: SessionKind, subjectId: string): Promise<number> {
  const ids = await redis().smembers(indexKey(kind, subjectId));
  if (ids.length) await redis().del(...ids.map(sessionKey));
  await redis().del(indexKey(kind, subjectId));
  return ids.length;
}
