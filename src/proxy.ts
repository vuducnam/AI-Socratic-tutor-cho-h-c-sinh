import { NextResponse, type NextRequest } from 'next/server';

// Lớp chặn trước khi render (quy tắc cứng 11). Chỉ kiểm sự có mặt của cookie để chuyển hướng sớm;
// xác thực thật (Redis + vai trò) nằm trong layout/route/Server Action và DAL, vì proxy không bảo vệ
// được Server Action.
//
// - /admin/** trả 404 khi ADMIN_ENABLED !== 'true' (container `app` công khai).
// - /parent/**, /learn/** cần cookie phiên app; /admin/** (trừ /admin/login) cần cookie admin.
// - Mọi route khác trên cổng công khai đều cần phiên, trừ /login, /api/health, /api/auth/*, /offline.

const APP_COOKIE = 'cu_session';
const ADMIN_COOKIE = 'cu_admin_session';

const PUBLIC_PREFIXES = ['/login', '/api/health', '/api/auth/', '/offline'];

function notFound() {
  return new NextResponse('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow' } });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (process.env.ADMIN_ENABLED !== 'true') return notFound();
    if (pathname === '/admin/login' || pathname.startsWith('/admin/api/login')) return NextResponse.next();
    if (!request.cookies.has(ADMIN_COOKIE)) return NextResponse.redirect(new URL('/admin/login', request.url));
    return NextResponse.next();
  }

  if (pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!request.cookies.has(APP_COOKIE)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Bỏ qua file tĩnh; mọi đường dẫn khác (kể cả POST Server Action) đi qua proxy.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|sw.js|icons/).*)'],
};
