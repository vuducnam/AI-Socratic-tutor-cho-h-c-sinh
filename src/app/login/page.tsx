import type { Metadata } from 'next';
import { LoginTabs } from './login-tabs';

export const metadata: Metadata = { title: 'Đăng nhập · Mít' };
export const dynamic = 'force-dynamic';

// Trang đăng nhập duy nhất trên cổng công khai. Không có đăng ký: tài khoản do admin tạo (quy tắc cứng 11).
export default function LoginPage() {
  return (
    <main className="login-page">
      <h1>Mít</h1>
      <p className="muted">Bạn học cùng của con</p>
      <LoginTabs />
      <p className="muted small">Bố mẹ xem được mọi cuộc trò chuyện của con với Mít.</p>
    </main>
  );
}
