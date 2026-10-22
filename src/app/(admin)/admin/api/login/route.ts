import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import { loginAccount } from '@/server/auth/account-login';
import { requestContextFromHeaders } from '@/server/auth/client-ip';
import { ADMIN_SESSION_COOKIE, sessionCookieOptions } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  totpCode: z.string().trim().max(6).nullable().optional(),
  turnstileToken: z.string().max(2048).nullable().optional(),
});

// Đăng nhập admin: chỉ container admin (ADMIN_ENABLED=true); container app trả 404 (proxy và loginAccount).
export async function POST(request: Request) {
  if (process.env.ADMIN_ENABLED !== 'true') return new Response('Not found', { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid', message: 'Email hoặc mật khẩu chưa đúng.' }, { status: 400 });
  }
  const result = await loginAccount({
    role: 'admin',
    email: parsed.data.email,
    password: parsed.data.password,
    totpCode: parsed.data.totpCode || null,
    turnstileToken: parsed.data.turnstileToken ?? null,
    request: requestContextFromHeaders(await headers()),
  });
  if (!result.ok) {
    return Response.json({ error: result.code, message: result.message }, { status: result.status });
  }
  (await cookies()).set(ADMIN_SESSION_COOKIE, result.sessionCookie, sessionCookieOptions());
  return Response.json({ ok: true, redirect: '/admin' });
}
