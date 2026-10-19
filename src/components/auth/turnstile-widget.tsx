'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

// Cloudflare Turnstile chế độ Managed trên form đăng nhập (quy tắc cứng 11). Token gửi kèm form; server
// xác minh bằng siteverify trước khi kiểm PIN/mật khẩu.

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({
  onToken,
  resetSignal,
}: {
  onToken: (token: string | null) => void;
  /** Đổi giá trị để lấy token mới sau mỗi lần gửi (token chỉ dùng được một lần). */
  resetSignal: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  const renderWidget = () => {
    if (!ref.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      language: 'vi',
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(null),
      'error-callback': () => onToken(null),
    });
  };

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      onToken(null);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetSignal, onToken]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderWidget}
      />
      <div ref={ref} className="turnstile" />
    </>
  );
}
