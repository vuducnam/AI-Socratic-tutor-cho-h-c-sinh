import 'server-only';

// Giới hạn phiên/ngày theo hồ sơ (SPEC §13): hết giờ thì Cú chào và khoá /learn tới hôm sau.
// Thời lượng tính từ started_at tới last_activity_at (hoặc ended_at) của các phiên trong ngày (giờ VN).

export const DAILY_LIMIT_MESSAGE = 'Hôm nay mình học đủ rồi. Bạn nghỉ ngơi nhé, mai Cú chờ bạn!';
export const SESSION_LIMIT_MESSAGE = 'Mình học được một lúc rồi. Bạn nghỉ một chút rồi quay lại nhé!';

export interface SessionSpan {
  started_at: Date;
  last_activity_at: Date;
  ended_at: Date | null;
}

const VN_OFFSET_MS = 7 * 3600_000;

export function startOfVietnamDay(now = new Date()): Date {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - VN_OFFSET_MS);
}

export function minutesUsed(sessions: SessionSpan[], now = new Date()): number {
  const dayStart = startOfVietnamDay(now).getTime();
  return sessions.reduce((sum, s) => {
    const start = Math.max(s.started_at.getTime(), dayStart);
    const end = (s.ended_at ?? s.last_activity_at).getTime();
    return sum + Math.max(0, end - start) / 60_000;
  }, 0);
}

export function learningPrefsLimits(prefs: unknown, preset: { session_minutes: number; daily_limit_minutes: number }) {
  const p = (prefs ?? {}) as { session_minutes?: unknown; daily_limit_minutes?: unknown };
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 && v <= 240 ? v : fallback);
  return { sessionMinutes: num(p.session_minutes, preset.session_minutes), dailyMinutes: num(p.daily_limit_minutes, preset.daily_limit_minutes) };
}
