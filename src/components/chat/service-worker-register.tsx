'use client';

import { useEffect } from 'react';

// Đăng ký service worker (màn hình "Cú đang nghỉ" khi PC tắt). Lỗi đăng ký không ảnh hưởng việc học.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
