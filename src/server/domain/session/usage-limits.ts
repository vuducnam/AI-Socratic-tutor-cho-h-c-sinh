import 'server-only';

// Giới hạn phiên/ngày theo hồ sơ (SPEC §13): hết giờ thì Cú chào và khoá /learn tới hôm sau.
// Thời lượng tính từ started_at tới lượt hoạt động cuối (last_activity_at) của các phiên trong ngày (giờ VN).
// ended_at chỉ được tính khi sát lượt cuối (con bấm "Xong hôm nay", hết giờ): phiên bỏ dở bị worker đóng
// sau 30 phút không hoạt động có ended_at = lúc đóng, khoảng ngồi không đó không phải thời gian học.
const END_GRACE_MS = 5 * 60_000;

export const DAILY_LIMIT_MESSAGE = 'Hôm nay mình học đủ rồi. Bạn nghỉ ngơi nhé, mai Mít chờ bạn!';
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
    const lastActivity = s.last_activity_at.getTime();
    const ended = s.ended_at?.getTime();
    const end = ended !== undefined && ended - lastActivity <= END_GRACE_MS ? Math.max(ended, lastActivity) : lastActivity;
    return sum + Math.max(0, end - start) / 60_000;
  }, 0);
}

export function learningPrefsLimits(prefs: unknown, preset: { session_minutes: number; daily_limit_minutes: number }) {
  const p = (prefs ?? {}) as { session_minutes?: unknown; daily_limit_minutes?: unknown };
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 && v <= 240 ? v : fallback);
  return { sessionMinutes: num(p.session_minutes, preset.session_minutes), dailyMinutes: num(p.daily_limit_minutes, preset.daily_limit_minutes) };
}
