import { Baloo_2, Quicksand } from 'next/font/google';

// Font giao diện học sinh (và trang đăng nhập): Baloo 2 tròn, vui cho tiêu đề; Quicksand mềm, dễ đọc cho nội dung
// và nút. Cả hai có bộ chữ tiếng Việt. next/font tự host lúc build, trang không gọi ra Google khi chạy.
const display = Baloo_2({ subsets: ['latin', 'vietnamese'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });
const body = Quicksand({ subsets: ['latin', 'vietnamese'], weight: ['500', '600', '700'], variable: '--font-body', display: 'swap' });

/** Gắn lên phần tử gốc của khu học sinh để dùng var(--font-display) / var(--font-body). */
export const kidFontVariables = `${display.variable} ${body.variable}`;
