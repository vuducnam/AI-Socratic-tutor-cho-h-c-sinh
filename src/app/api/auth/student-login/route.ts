import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { requestContextFromHeaders } from '@/server/auth/client-ip';
import { APP_SESSION_COOKIE, DEVICE_COOKIE, sessionCookieOptions } from '@/server/auth/session';
import { loginStudent } from '@/server/auth/student-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  pin: z.string().regex(/^\d{6}$/),
  turnstileToken: z.string().max(2048).nullable().optional(),
});

const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 3600;

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid', message: 'Tên đăng nhập hoặc mã PIN chưa đúng.' }, { status: 400 });
  }
  const store = await cookies();
  const result = await loginStudent({
    username: parsed.data.username,
    pin: parsed.data.pin,
    turnstileToken: parsed.data.turnstileToken ?? null,
    deviceToken: store.get(DEVICE_COOKIE)?.value ?? null,
    request: requestContextFromHeaders(await headers()),
  });
  if (!result.ok) {
    return Response.json({ error: result.code, message: result.message }, { status: result.status });
  }
  const ttl = Math.max(60, Math.floor((result.expiresAt - Date.now()) / 1000));
  store.set(APP_SESSION_COOKIE, result.sessionCookie, sessionCookieOptions(Math.min(ttl, 12 * 3600)));
  if (result.deviceToken) store.set(DEVICE_COOKIE, result.deviceToken, sessionCookieOptions(DEVICE_COOKIE_MAX_AGE));
  return Response.json({ ok: true, redirect: '/learn' });
}
