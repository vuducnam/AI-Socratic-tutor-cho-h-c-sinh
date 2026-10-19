import 'server-only';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';

// Thư viện tình huống đời thật (data/life-contexts/<subject>/grade<N>.yaml, SPEC §5b, quy tắc cứng 13).
// - Biến số do CODE điền trong khoảng khai báo (LLM không tự đặt số), sinh ngược từ đáp án sạch nhờ
//   `answer_expression` + `max_answer_decimals`.
// - Duyệt đi theo dữ liệu: approved: {by, at, content_hash}. Mẫu sửa sau khi duyệt (hash đổi) → mất duyệt.

export const THEMES = ['market', 'cooking', 'sport', 'nature', 'animals', 'travel', 'home', 'game', 'school', 'other'] as const;
export type Theme = (typeof THEMES)[number];

const variableSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    unit: z.string().max(20).default(''),
    /** Nhãn ngắn trên hình minh hoạ (ví dụ "Lan"); mặc định là tên biến. */
    label: z.string().max(30).optional(),
  })
  .refine((v) => v.min <= v.max, 'min phải ≤ max');

export const lifeContextTemplateSchema = z.object({
  setup: z.string().min(1).max(400),
  real_question: z.string().min(1).max(200),
  variables: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), variableSchema),
  /** Biểu thức tính đáp án từ biến (dấu chấm, + - * / ngoặc), để chọn số cho đáp án sạch. */
  answer_expression: z.string().min(1).max(200),
  max_answer_decimals: z.number().int().min(0).max(3).default(2),
  /** Điều kiện thêm giữa các biến, ví dụ "a > b" (so sánh hai biểu thức đơn giản). */
  conditions: z.array(z.string().max(100)).default([]),
  svg_kind: z.enum(['segment_bar', 'fraction_grid', 'number_line', 'box', 'none']).default('none'),
});

export const lifeContextSchema = z.object({
  id: z.string().regex(/^[A-Z0-9_.]+$/),
  skill_id: z.string().min(1),
  theme: z.enum(THEMES),
  template: lifeContextTemplateSchema,
  min_grade: z.number().int().min(1).max(12),
  max_grade: z.number().int().min(1).max(12),
  safety: z.object({ adult_required: z.boolean(), notes: z.string().max(300).default('') }),
  approved: z
    .object({ by: z.email(), at: z.union([z.iso.date(), z.date().transform((d) => d.toISOString().slice(0, 10))]), content_hash: z.string() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type LifeContextDef = z.infer<typeof lifeContextSchema>;
export type LifeContextTemplate = z.infer<typeof lifeContextTemplateSchema>;

/** Hash nội dung (mọi thứ trừ trạng thái duyệt): đổi mẫu sau khi duyệt thì phải duyệt lại. */
export function lifeContextContentHash(ctx: Omit<LifeContextDef, 'approved'>): string {
  const content = {
    id: ctx.id,
    skill_id: ctx.skill_id,
    theme: ctx.theme,
    template: ctx.template,
    min_grade: ctx.min_grade,
    max_grade: ctx.max_grade,
    safety: ctx.safety,
  };
  return createHash('sha256').update(stableStringify(content)).digest('hex').slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class LifeContextSeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Seed tình huống bị từ chối:\n- ${problems.join('\n- ')}`);
    this.name = 'LifeContextSeedError';
  }
}

// Kiểm tra theo tiêu chuẩn SPEC §5b.4 phần code làm được.
const BRAND_HINTS = /\b(coca|pepsi|vinamilk|kfc|lotte|samsung|iphone|honda|yamaha|grab|shopee|lazada|tiki|circle ?k|highlands)\b/i;
const UNSAFE_ALONE = /(một mình|tự đi|ra đường|qua đường|dùng dao|bật bếp|cắm điện|leo lên)/u;

export function parseLifeContextFile(file: string, text: string, knownSkillIds: Set<string>): LifeContextDef[] {
  const doc = z.object({ subject: z.string(), grade: z.number().int(), contexts: z.array(z.unknown()).nullable().default([]) }).safeParse(parse(text));
  if (!doc.success) throw new LifeContextSeedError(doc.error.issues.map((i) => `${file} › ${i.path.join('.')}: ${i.message}`));
  const problems: string[] = [];
  const out: LifeContextDef[] = [];
  const ids = new Set<string>();
  (doc.data.contexts ?? []).forEach((raw, i) => {
    const label = String((raw as { id?: unknown })?.id ?? `contexts[${i}]`);
    const r = lifeContextSchema.safeParse(raw);
    if (!r.success) {
      problems.push(...r.error.issues.map((x) => `${file} › ${label} › ${x.path.join('.')}: ${x.message}`));
      return;
    }
    const c = r.data;
    if (ids.has(c.id)) problems.push(`${file} › ${c.id}: id trùng`);
    ids.add(c.id);
    if (!knownSkillIds.has(c.skill_id)) problems.push(`${file} › ${c.id}: skill_id không tồn tại ${c.skill_id}`);
    const prose = `${c.template.setup} ${c.template.real_question}`;
    if (BRAND_HINTS.test(prose)) problems.push(`${file} › ${c.id}: có tên nhãn hàng`);
    if (UNSAFE_ALONE.test(prose) && !c.safety.adult_required) problems.push(`${file} › ${c.id}: hoạt động cần người lớn nhưng adult_required = false`);
    const used = [...prose.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]!);
    for (const v of used) if (!(v in c.template.variables)) problems.push(`${file} › ${c.id}: biến {${v}} chưa khai báo`);
    out.push(c);
  });
  if (problems.length) throw new LifeContextSeedError(problems);
  return out;
}

/** Không để tiền/mua sắm chiếm quá 1/3 thư viện của một skill (SPEC §5b.4). */
export function themeBalanceWarnings(contexts: LifeContextDef[]): string[] {
  const bySkill = new Map<string, LifeContextDef[]>();
  for (const c of contexts) bySkill.set(c.skill_id, [...(bySkill.get(c.skill_id) ?? []), c]);
  const warnings: string[] = [];
  for (const [skill, list] of bySkill) {
    const market = list.filter((c) => c.theme === 'market').length;
    if (market * 3 > list.length) warnings.push(`${skill}: chủ đề market chiếm ${market}/${list.length} (> 1/3)`);
    if (list.length < 8) warnings.push(`${skill}: mới có ${list.length} tình huống (cần ≥ 8)`);
  }
  return warnings;
}
