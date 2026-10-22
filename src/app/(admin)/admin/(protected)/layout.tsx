import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { assertAdminRuntime, UnauthenticatedError } from '@/server/auth/session';
import { adminLogoutAction } from './actions';

export const dynamic = 'force-dynamic';

// Khu quản trị: chỉ chạy ở container admin (ADMIN_ENABLED=true, sau Tailscale Serve), cần phiên admin.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (process.env.ADMIN_ENABLED !== 'true') notFound();
  try {
    await assertAdminRuntime();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/admin/login');
    throw err;
  }
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <a href="/admin">
          <strong>Mít · Quản trị</strong>
        </a>
        <form action={adminLogoutAction}>
          <button type="submit" className="link-button">
            Đăng xuất
          </button>
        </form>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
