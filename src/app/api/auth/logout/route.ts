import { APP_SESSION_COOKIE, logoutCurrent } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await logoutCurrent(APP_SESSION_COOKIE);
  return Response.json({ ok: true, redirect: '/login' });
}
