import 'server-only';

// Cloudflare Turnstile (quy tắc cứng 11, SPEC §14b): xác minh token qua siteverify TRƯỚC khi kiểm mật
// khẩu/PIN. Không gửi IP người dùng. Token sai/hết hạn/dùng lại → từ chối; siteverify lỗi → từ chối
// (fail closed). Test keys chính thức: secret 1x...AA luôn pass, 2x...AA luôn fail.

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing_token' | 'invalid_token' | 'unavailable' };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function verifyTurnstileToken(
  token: string | null | undefined,
  options: { secret?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { ok: false, reason: 'missing_token' };
  const secret = options.secret ?? process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, reason: 'unavailable' };
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const body = new URLSearchParams({ secret, response: token });
    const res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: unknown };
    return data.success === true ? { ok: true } : { ok: false, reason: 'invalid_token' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
