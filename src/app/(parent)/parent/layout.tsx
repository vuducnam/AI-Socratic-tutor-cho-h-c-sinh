import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireParentActor, UnauthenticatedError } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// Khu phụ huynh: cần phiên role parent. Mọi trang chỉ gọi DAL (quy tắc cứng 12), không cache.
export default async function ParentLayout({ children }: { children: ReactNode }) {
  try {
    await requireParentActor();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/login');
    throw err;
  }
  return (
    <div className="parent-shell">
      <header className="parent-header">
        <a href="/parent">
          <strong>Cú · Phụ huynh</strong>
        </a>
        <nav>
          <a href="/parent/progress">Tiến độ trên lớp</a>
        </nav>
      </header>
      <main className="parent-main">{children}</main>
    </div>
  );
}
