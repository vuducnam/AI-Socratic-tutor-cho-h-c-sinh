import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStudentActor, UnauthenticatedError } from '@/server/auth/session';
import '../../learn.css';

export const dynamic = 'force-dynamic';

// Khu học sinh: cần phiên học sinh. Banner minh bạch luôn hiển thị (quy tắc cứng 8).
export default async function LearnLayout({ children }: { children: ReactNode }) {
  try {
    await requireStudentActor();
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect('/login');
    throw err;
  }
  return (
    <div className="learn-shell">
      <div className="transparency-banner" role="note">
        Bố mẹ xem được cuộc trò chuyện này
      </div>
      {children}
    </div>
  );
}
