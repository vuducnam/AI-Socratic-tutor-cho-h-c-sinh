import 'server-only';

// IP client cho rate limit và access_log (phase 04):
// - container `app` chỉ vào được qua Cloudflare Tunnel → tin `CF-Connecting-IP`, bỏ qua X-Forwarded-For
//   (client tự đặt được);
// - container `admin` (ADMIN_ENABLED=true, sau Tailscale Serve trên localhost) → địa chỉ do server Next
//   ghi vào X-Forwarded-For (giá trị cuối cùng, do proxy gần nhất thêm).
export function clientIpFromHeaders(headers: Headers): string | null {
  if (process.env.ADMIN_ENABLED !== 'true') {
    return headers.get('cf-connecting-ip')?.trim() || null;
  }
  const xff = headers.get('x-forwarded-for');
  if (!xff) return null;
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

export function requestContextFromHeaders(headers: Headers) {
  return { ip: clientIpFromHeaders(headers), userAgent: headers.get('user-agent') };
}
