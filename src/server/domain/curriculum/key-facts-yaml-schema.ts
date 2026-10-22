import 'server-only';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';

// Ý chính từng bài của môn kiến thức: data/key-facts/<subject>/grade<N>.yaml (SPEC §5d, quy tắc cứng 6).
// Nguồn duy nhất là bản đọc SGK chính thống; `statement` là lời diễn đạt ngắn, không chép nguyên văn sách
// (chặn câu dài hơn 25 từ). Duyệt theo bài: approved.content_hash phải khớp hash hiện tại, sửa sau khi duyệt thì
// bài trở về chưa duyệt. Luật từ chối nêu rõ file + lesson_id/fact_id.

export const KEY_FACT_KINDS = ['date', 'place', 'person', 'event', 'cause', 'result', 'feature', 'figure', 'symbol'] as const;
export const MAX_STATEMENT_WORDS = 25;

const dateLike = z.union([z.iso.date(), z.date().transform((d) => d.toISOString().slice(0, 10))]);

const factSchema = z.object({
  fact_id: z.string().regex(/^[A-Z0-9]+(\.[A-Z0-9]+)+\.F\d+$/, 'fact_id dạng HG5.SGK.B15.F1'),
  statement: z.string().trim().min(1),
  kind: z.enum(KEY_FACT_KINDS),
  accept: z.array(z.string().trim().min(1)).min(1).max(6),
  // Chữ Mít không được nói khi con chưa nêu ý này (đồ vật trong hình, chữ gợi gần đáp án); chỉ dùng để chặn, không
  // dùng để chấm con đã nêu ý chưa. Con tự nói chữ đó thì Mít nhắc lại được.
  withhold: z.array(z.string().trim().min(1)).max(12).default([]),
  pages: z.union([z.string(), z.number()]).transform(String),
  locator: z.string().trim().min(1),
});

const lessonSchema = z.object({
  lesson_id: z.string().min(1),
  objectives: z.array(z.string().min(1)).nullable().default([]).transform((v) => v ?? []),
  question_styles: z.array(z.string().min(1)).nullable().default([]).transform((v) => v ?? []),
  opinion_prompts_present: z.boolean().default(false),
  facts: z.array(factSchema).nullable().default([]).transform((v) => v ?? []),
  approved: z
    .object({ by: z.email(), at: dateLike, content_hash: z.string() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const fileSchema = z.object({ subject: z.string().min(1), grade: z.number().int(), lessons: z.array(z.unknown()) });

// withhold tuỳ chọn ở kiểu (dữ liệu dựng tay trong test, file cũ): không có nghĩa là danh sách rỗng.
export type KeyFactDef = Omit<z.infer<typeof factSchema>, 'withhold'> & { withhold?: string[] };
export type KeyFactLessonDef = Omit<z.infer<typeof lessonSchema>, 'facts'> & { facts: KeyFactDef[]; subject: string };

export class KeyFactsSeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Seed ý chính bị từ chối:\n- ${problems.join('\n- ')}`);
    this.name = 'KeyFactsSeedError';
  }
}

/** Hash nội dung một bài (mục tiêu + ý chính, theo thứ tự trong file): đổi sau khi duyệt thì phải duyệt lại. */
export function keyFactsLessonHash(lesson: Pick<KeyFactLessonDef, 'lesson_id' | 'objectives' | 'facts'>): string {
  const content = {
    lesson_id: lesson.lesson_id,
    objectives: lesson.objectives,
    // withhold chỉ vào hash khi có, để hash của bài chưa có danh sách này không đổi.
    facts: lesson.facts.map((f) => [f.fact_id, f.statement, f.kind, f.accept, f.pages, f.locator, ...(f.withhold?.length ? [f.withhold] : [])]),
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

/** "65", "65-66", "65, 67" → các số trang; chuỗi lạ → null. */
export function parsePages(pages: string): number[] | null {
  const out: number[] = [];
  for (const part of pages.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (to < from) return null;
    for (let p = from; p <= to; p++) out.push(p);
  }
  return out.length ? out : null;
}

// Đếm chữ và số, không đếm dấu gạch đứng riêng trong ngày tháng ("22 – 8 – 1945").
const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Đọc và kiểm một file ý chính. `lessonPages`: lesson_id → khoảng trang của bài theo mục lục đã seed; ý chính
 * phải nằm trong trang của chính bài đó (Mít chỉ con mở đúng trang).
 */
export function parseKeyFactsFile(file: string, text: string, lessonPages: Map<string, number[]>): KeyFactLessonDef[] {
  const doc = fileSchema.safeParse(parse(text));
  if (!doc.success) throw new KeyFactsSeedError(doc.error.issues.map((i) => `${file} › ${i.path.join('.')}: ${i.message}`));
  const problems: string[] = [];
  const out: KeyFactLessonDef[] = [];
  const factIds = new Set<string>();
  doc.data.lessons.forEach((raw, i) => {
    const label = String((raw as { lesson_id?: unknown })?.lesson_id ?? `lessons[${i}]`);
    const r = lessonSchema.safeParse(raw);
    if (!r.success) {
      problems.push(...r.error.issues.map((x) => `${file} › ${label} › ${x.path.join('.')}: ${x.message}`));
      return;
    }
    const lesson = r.data;
    const range = lessonPages.get(lesson.lesson_id);
    if (!range) problems.push(`${file} › ${lesson.lesson_id}: bài không có trong mục lục`);
    for (const f of lesson.facts) {
      const where = `${file} › ${f.fact_id}`;
      if (!f.fact_id.startsWith(`${lesson.lesson_id}.F`)) problems.push(`${where}: fact_id phải bắt đầu bằng ${lesson.lesson_id}.F`);
      if (factIds.has(f.fact_id)) problems.push(`${where}: fact_id trùng`);
      factIds.add(f.fact_id);
      if (wordCount(f.statement) > MAX_STATEMENT_WORDS) problems.push(`${where}: statement quá ${MAX_STATEMENT_WORDS} từ (diễn đạt ngắn, không chép sách)`);
      for (const a of [...f.accept, ...(f.withhold ?? [])]) {
        if (a !== a.normalize('NFC').toLocaleLowerCase('vi')) problems.push(`${where}: accept "${a}" phải viết thường, NFC`);
      }
      const pages = parsePages(f.pages);
      if (!pages) problems.push(`${where}: pages "${f.pages}" không đọc được`);
      else if (range && pages.some((p) => !range.includes(p))) problems.push(`${where}: trang ${f.pages} ngoài trang của bài (${range[0]}-${range.at(-1)})`);
    }
    out.push({ ...lesson, subject: doc.data.subject });
  });
  if (problems.length) throw new KeyFactsSeedError(problems);
  return out;
}
