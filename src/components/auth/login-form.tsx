'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { TurnstileWidget } from './turnstile-widget';

// Form đăng nhập dùng chung: học sinh (tên đăng nhập + PIN 6 số), phụ huynh và admin (email + mật khẩu
// + TOTP khi đã bật). Không có đường dẫn đăng ký (quy tắc cứng 11).

type Mode = 'student' | 'parent' | 'admin';

const ENDPOINTS: Record<Mode, string> = {
  student: '/api/auth/student-login',
  parent: '/api/auth/parent-login',
  admin: '/admin/api/login',
};

export function LoginForm({ mode }: { mode: Mode }) {
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const body =
      mode === 'student'
        ? { username: form.get('username'), pin: form.get('pin'), turnstileToken: token }
        : { email: form.get('email'), password: form.get('password'), totpCode: form.get('totp') || null, turnstileToken: token };
    try {
      const res = await fetch(ENDPOINTS[mode], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; message?: string; error?: string };
      if (res.ok && data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      if (data.error === 'totp_required') setNeedTotp(true);
      setError(data.message ?? 'Chưa đăng nhập được, thử lại nhé.');
    } catch {
      setError('Cú đang nghỉ, thử lại sau nhé.');
    } finally {
      setBusy(false);
      setResetSignal((n) => n + 1);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {mode === 'student' ? (
        <>
          <label>
            Tên đăng nhập
            <input name="username" autoComplete="username" autoCapitalize="none" required maxLength={64} />
          </label>
          <label>
            Mã PIN (6 số)
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="current-password"
              required
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required maxLength={200} />
          </label>
          <label>
            Mật khẩu
            <input name="password" type="password" autoComplete="current-password" required maxLength={200} />
          </label>
          {needTotp && (
            <label>
              Mã xác thực (6 số)
              <input name="totp" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
            </label>
          )}
        </>
      )}
      <TurnstileWidget onToken={onToken} resetSignal={resetSignal} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !token}>
        {busy ? 'Đang vào…' : 'Vào'}
      </button>
    </form>
  );
}
