import 'server-only';
import { redis } from './redis-client';

// Rate limit trong app theo IP và theo tài khoản (SPEC §2.2). Lớp biên Cloudflare có thể cấu hình sai
// hoặc bị vượt qua, nên app vẫn tự chặn. Cửa sổ cố định trên Redis.

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const LOGIN_RATE_LIMITS = {
  perIp: { name: 'login-ip', limit: 20, windowSeconds: 600 },
  // Cao hơn ngưỡng khoá PIN (10) để luật khoá của SPEC quyết định, rate limit chỉ chặn dò hàng loạt.
  perAccount: { name: 'login-account', limit: 30, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function hitRateLimit(rule: RateLimitRule, key: string): Promise<RateLimitResult> {
  const redisKey = `rl:${rule.name}:${key}`;
  const [[, countRaw], [, ttlRaw]] = (await redis()
    .multi()
    .incr(redisKey)
    .ttl(redisKey)
    .exec()) as [[unknown, number], [unknown, number]];
  const count = Number(countRaw);
  let ttl = Number(ttlRaw);
  if (ttl < 0) {
    await redis().expire(redisKey, rule.windowSeconds);
    ttl = rule.windowSeconds;
  }
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterSeconds: ttl };
}

export async function resetRateLimit(rule: RateLimitRule, key: string): Promise<void> {
  await redis().del(`rl:${rule.name}:${key}`);
}
