import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Cú đang nghỉ' };
export const dynamic = 'force-static';

// Trang tĩnh service worker cache sẵn: hiện khi PC tắt hoặc app không phản hồi (không lỗi kỹ thuật).
export default function OfflinePage() {
  return (
    <main className="login-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- icon tĩnh đã cache trong service worker */}
      <img src="/icons/owl.svg" alt="" width={96} height={96} />
      <h1>Cú đang nghỉ</h1>
      <p>Bạn hỏi bố nhé. Lát nữa bạn mở lại trang này.</p>
    </main>
  );
}
