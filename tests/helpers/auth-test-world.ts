import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { hashSecret } from '@/server/auth/password';
import { redis } from '@/server/auth/redis-client';
import { mintActor } from '@/server/dal/mint-actor';
import { createParentAccount } from '@/server/dal/users-dal';
import { createStudent, linkParentToStudent } from '@/server/dal/students-dal';

// Turnstile test keys chính thức của Cloudflare: secret 1x… luôn pass, 2x… luôn fail. Test giả lập
// siteverify ở tầng HTTP theo đúng hành vi đó (không gọi mạng).
export const TURNSTILE_PASS_SECRET = '1x0000000000000000000000000000000AA';
export const TURNSTILE_FAIL_SECRET = '2x0000000000000000000000000000000AA';

export function stubTurnstileSiteverify() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body));
    const success = body.get('secret') === TURNSTILE_PASS_SECRET && !!body.get('response');
    // Không gửi IP người dùng sang Cloudflare.
    if (body.has('remoteip')) throw new Error('không được gửi remoteip');
    return new Response(JSON.stringify({ success }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  process.env.TURNSTILE_SECRET_KEY = TURNSTILE_PASS_SECRET;
  return fetchMock;
}

/** Xoá Redis của test (chỉ khi REDIS_URL trỏ DB riêng /1, không bao giờ DB 0 của dev). */
export async function resetTestRedis() {
  const url = process.env.REDIS_URL ?? '';
  if (!/\/1$/.test(url)) throw new Error('REDIS_URL của test phải trỏ DB /1');
  await redis().flushdb();
}

export async function createAdminWorld(options: { isFamily?: boolean; pin?: string; password?: string } = {}) {
  process.env.ADMIN_ENABLED = 'true';
  process.env.SESSION_SECRET ??= 'test-session-secret-0123456789';
  process.env.ADMIN_SESSION_SECRET ??= 'test-admin-secret-0123456789';
  const tag = randomUUID().slice(0, 8);
  const { appDb } = await import('./test-database');
  const { rows } = await appDb().query<{ id: string }>(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Admin', $1, $2) RETURNING id`,
    [`admin-${tag}@test.local`, await hashSecret(options.password ?? 'admin-password-123')],
  );
  const admin = mintActor('admin', rows[0]!.id);
  const password = options.password ?? 'parent-password-123';
  const parentEmail = `parent-${tag}@test.local`;
  const parentId = await createParentAccount(admin, { name: 'Bố', email: parentEmail, passwordHash: await hashSecret(password) });
  const pin = options.pin ?? '246813';
  const username = `be-${tag}`;
  const studentId = await createStudent(admin, {
    username,
    displayName: 'Bé',
    gender: 'male',
    pinHash: await hashSecret(pin),
    grade: 5,
    preset: 'grade5',
    isFamily: options.isFamily ?? true,
    interests: [],
    companionName: 'Mít',
  });
  await linkParentToStudent(admin, { parentId, studentId });
  return {
    admin,
    adminEmail: `admin-${tag}@test.local`,
    parentId,
    parentEmail,
    password,
    studentId,
    username,
    pin,
  };
}
