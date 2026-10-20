import Link from 'next/link';
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
          <strong>Mít · Phụ huynh</strong>
        </a>
        <nav>
          <Link href="/parent">Tổng quan</Link>
          <Link href="/parent/sessions">Phiên</Link>
          <Link href="/parent/flags">Cờ</Link>
          <Link href="/parent/progress">Tiến độ trên lớp</Link>
          <Link href="/parent/review">Duyệt</Link>
          <Link href="/parent/independent">Dữ liệu độc lập</Link>
          <Link href="/parent/settings">Cấu hình</Link>
          <Link href="/parent/data">Dữ liệu</Link>
        </nav>
      </header>
      <main className="parent-main">{children}</main>
    </div>
  );
}
