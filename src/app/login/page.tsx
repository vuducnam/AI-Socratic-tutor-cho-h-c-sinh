import type { Metadata } from 'next';
import { OwlAvatar } from '@/components/chat/owl-avatar';
import { kidFontVariables } from '../kid-fonts';
import { LoginTabs } from './login-tabs';

export const metadata: Metadata = { title: 'Đăng nhập · Mít' };
export const dynamic = 'force-dynamic';

// Trang đăng nhập duy nhất trên cổng công khai. Không có đăng ký: tài khoản do admin tạo (quy tắc cứng 11).
export default function LoginPage() {
  return (
    <main className={`login-page kid-theme ${kidFontVariables}`}>
      <div className="login-hero">
        <OwlAvatar size={112} />
        <h1>Mít</h1>
        <p className="muted">Bạn học cùng của bạn</p>
      </div>
      <LoginTabs />
      <p className="muted small">Bố mẹ xem được mọi cuộc trò chuyện với Mít.</p>
    </main>
  );
}
