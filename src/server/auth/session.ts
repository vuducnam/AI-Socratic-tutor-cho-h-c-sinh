import 'server-only';
import { cookies } from 'next/headers';
import type { AdminActor, ParentActor, StudentActor } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { findActiveStudent } from '@/server/dal/students-dal';
import { findActiveUser } from '@/server/dal/users-dal';
import {
  decodeSessionCookie,
  destroySession,
  IDLE_TIMEOUT_SECONDS,
  loadSession,
  type SessionKind,
  type SessionRecord,
} from './session-store';

// Nơi duy nhất (cùng worker/actor.ts) tạo Actor: chỉ từ phiên đã xác thực (SPEC §3.3).
// Cookie app (phụ huynh/học sinh) và cookie admin khác tên, khác secret ký, không dùng chung phiên.

export const APP_SESSION_COOKIE = 'cu_session';
export const ADMIN_SESSION_COOKIE = 'cu_admin_session';
export const DEVICE_COOKIE = 'cu_device';

export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED';
  constructor() {
    super('Chưa đăng nhập');
    this.name = 'UnauthenticatedError';
  }
}

export function sessionCookieOptions(maxAgeSeconds = IDLE_TIMEOUT_SECONDS) {
  return {
    httpOnly: true,
    // Trình duyệt chấp nhận cookie Secure trên http://localhost, nên dev cũng bật.
    secure: true,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

async function readSession(cookieName: string, kinds: SessionKind[]): Promise<SessionRecord | null> {
  const store = await cookies();
  const signingKind: SessionKind = cookieName === ADMIN_SESSION_COOKIE ? 'admin' : 'parent';
  const id = decodeSessionCookie(signingKind, store.get(cookieName)?.value);
  return id ? loadSession(kinds, id) : null;
}

export async function currentAppSession(): Promise<SessionRecord | null> {
  return readSession(APP_SESSION_COOKIE, ['student', 'parent']);
}

export async function requireStudentActor(): Promise<StudentActor> {
  const session = await readSession(APP_SESSION_COOKIE, ['student']);
  if (!session || !(await findActiveStudent(session.subjectId))) throw new UnauthenticatedError();
  return mintActor('student', session.subjectId);
}

export async function requireParentActor(): Promise<ParentActor> {
  const session = await readSession(APP_SESSION_COOKIE, ['parent']);
  const user = session ? await findActiveUser(session.subjectId) : null;
  if (!session || !user || user.role !== 'parent') throw new UnauthenticatedError();
  return mintActor('parent', user.id);
}

/**
 * Mọi Server Action và trang quản trị gọi hàm này (không dựa vào proxy: Server Action gọi được bằng
 * header Next-Action tới bất kỳ đường dẫn nào). Cần ADMIN_ENABLED=true và phiên admin hợp lệ.
 */
export async function assertAdminRuntime(): Promise<AdminActor> {
  if (process.env.ADMIN_ENABLED !== 'true') throw new UnauthenticatedError();
  const session = await readSession(ADMIN_SESSION_COOKIE, ['admin']);
  const user = session ? await findActiveUser(session.subjectId) : null;
  if (!session || !user || user.role !== 'admin') throw new UnauthenticatedError();
  return mintActor('admin', user.id);
}

/** Admin xem học sinh không liên kết: kèm lý do, DAL ghi vào access_log (hiện cho phụ huynh của em đó). */
export function withAdminReason(actor: AdminActor, reason: string): AdminActor {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error('Cần nhập lý do');
  return mintActor('admin', actor.id, trimmed.slice(0, 300));
}

export async function logoutCurrent(cookieName: typeof APP_SESSION_COOKIE | typeof ADMIN_SESSION_COOKIE) {
  const store = await cookies();
  const signingKind: SessionKind = cookieName === ADMIN_SESSION_COOKIE ? 'admin' : 'parent';
  const id = decodeSessionCookie(signingKind, store.get(cookieName)?.value);
  if (id) await destroySession(id);
  store.delete(cookieName);
}
