import 'server-only';
import type { Theme } from './life-context-schema';

// Chọn tình huống bằng CODE (SPEC §5b.3 bước 1): chỉ context đã duyệt, đúng skill, skill trong phạm vi đã
// học, trong khoảng lớp; ưu tiên theme khớp sở thích; không lặp theme trong 3 bài gần nhất; không dùng lại
// context trong 7 ngày. Thư viện cạn → nới dần: (1) bỏ luật 7 ngày, (2) dùng lại context cũ nhất (số mới),
// (3) vẫn không có → báo cạn (ở lại SCAFFOLD(3) + system_alert). Không bao giờ sinh bài trơn.

export interface SelectableContext {
  id: string;
  skill_id: string;
  theme: Theme;
  min_grade: number;
  max_grade: number;
  approved: boolean;
}

export interface ContextUse {
  contextId: string;
  theme: Theme;
  usedAt: Date;
}

export interface SelectContextInput {
  contexts: SelectableContext[];
  targetSkillIds: string[];
  allowedSkillIds: string[];
  grade: number;
  interests: string[];
  /** Lần dùng gần nhất trước (mới nhất đứng đầu). */
  recentUses: ContextUse[];
  /** Context đã thử và fail trong lượt này. */
  exclude?: string[];
  now?: Date;
  random?: () => number;
}

export type SelectContextResult =
  | { ok: true; context: SelectableContext; relaxation: 'none' | 'ignore_7_days' | 'reuse_oldest' }
  | { ok: false; reason: 'context_pool_exhausted' };

const INTEREST_THEMES: [RegExp, Theme][] = [
  [/bóng|thể thao|chạy|bơi|cầu lông|võ|đá cầu|nhảy dây/u, 'sport'],
  [/nấu|bánh|ăn|bếp|nấu ăn/u, 'cooking'],
  [/cây|hoa|vườn|thiên nhiên|núi|biển/u, 'nature'],
  [/chó|mèo|cá|chim|con vật|thú/u, 'animals'],
  [/du lịch|đi chơi|tàu|máy bay|xe/u, 'travel'],
  [/game|trò chơi|xếp hình|lego|cờ|rubik/u, 'game'],
  [/đọc|truyện|vẽ|học|thư viện/u, 'school'],
  [/mua|chợ|bán hàng/u, 'market'],
];

export function themesForInterests(interests: string[]): Theme[] {
  const text = interests.join(' ').normalize('NFC').toLowerCase();
  return INTEREST_THEMES.filter(([re]) => re.test(text)).map(([, t]) => t);
}

const DAY_MS = 24 * 3600_000;

export function selectContext(input: SelectContextInput): SelectContextResult {
  const now = input.now ?? new Date();
  const random = input.random ?? Math.random;
  const exclude = new Set(input.exclude ?? []);
  const eligible = input.contexts.filter(
    (c) =>
      c.approved &&
      input.targetSkillIds.includes(c.skill_id) &&
      // Context của skill chưa học không bao giờ được chọn (quy tắc cứng 15).
      input.allowedSkillIds.includes(c.skill_id) &&
      c.min_grade <= input.grade &&
      input.grade <= c.max_grade &&
      !exclude.has(c.id),
  );
  if (!eligible.length) return { ok: false, reason: 'context_pool_exhausted' };

  const recentThemes = new Set(input.recentUses.slice(0, 3).map((u) => u.theme));
  const usedRecently = new Set(input.recentUses.filter((u) => now.getTime() - u.usedAt.getTime() < 7 * DAY_MS).map((u) => u.contextId));
  const preferred = new Set(themesForInterests(input.interests));

  const pick = (pool: SelectableContext[]) => {
    const liked = pool.filter((c) => preferred.has(c.theme));
    const from = liked.length ? liked : pool;
    return from[Math.floor(random() * from.length)]!;
  };

  const strict = eligible.filter((c) => !recentThemes.has(c.theme) && !usedRecently.has(c.id));
  if (strict.length) return { ok: true, context: pick(strict), relaxation: 'none' };

  const no7days = eligible.filter((c) => !recentThemes.has(c.theme));
  if (no7days.length) return { ok: true, context: pick(no7days), relaxation: 'ignore_7_days' };

  // Dùng lại context dùng lâu nhất (hoặc chưa từng dùng) với bộ số mới.
  const lastUse = new Map<string, number>();
  for (const u of input.recentUses) lastUse.set(u.contextId, Math.max(lastUse.get(u.contextId) ?? 0, u.usedAt.getTime()));
  const oldest = [...eligible].sort((a, b) => (lastUse.get(a.id) ?? 0) - (lastUse.get(b.id) ?? 0))[0]!;
  return { ok: true, context: oldest, relaxation: 'reuse_oldest' };
}
