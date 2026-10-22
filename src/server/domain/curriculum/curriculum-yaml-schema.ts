import 'server-only';
import { parse } from 'yaml';
import { z } from 'zod';
import { compileTermPattern, findTermMatches, InvalidTermPatternError } from '@/lib/term-pattern-matcher';

// Mục lục SGK theo đúng thứ tự (data/curriculum/<subject>/grade<N>.yaml) và thuật ngữ lớp trên
// (beyond-grade<N>.yaml). Luật từ chối theo SPEC §5c.1 / docs/CURRICULUM.md §8.1:
// thiếu source.official_url; regex `re:` hỏng; lesson_id trùng; book không có trong books[];
// seq trùng hoặc đứt quãng; skill_ids trỏ tới skill không tồn tại. Mỗi lỗi nêu file + lesson_id.

const dateOrNull = z
  .union([z.iso.date(), z.date().transform((d) => d.toISOString().slice(0, 10)), z.null()])
  .optional()
  .transform((v) => v ?? null);

const termSchema = z.object({ term: z.string().min(1), patterns: z.array(z.string().min(1)).min(1) });

const lessonSchema = z.object({
  lesson_id: z.string().regex(/^[A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+$/, 'lesson_id dạng MATH5.T1.B12'),
  seq: z.number().int().positive(),
  book: z.string().min(1),
  topic: z.string().nullable(),
  lesson_no: z.number().int().positive(),
  title: z.string().min(1),
  skill_ids: z.array(z.string()).nullable().default([]).transform((v) => v ?? []),
  introduces_terms: z.array(termSchema).nullable().default([]).transform((v) => v ?? []),
  methods: z.array(z.string().min(1)).nullable().default([]).transform((v) => v ?? []),
  source: z.object({
    official_url: z.url({ message: 'thiếu source.official_url' }),
    pages: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v == null ? null : String(v))),
    imported_at: dateOrNull,
  }),
});

const curriculumFileSchema = z.object({
  subject: z.string().min(1),
  grade: z.number().int().min(1).max(12),
  series: z.string().min(1),
  publisher: z.string().optional(),
  books: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), official_url: z.url() })).min(1),
  lessons: z.array(z.unknown()),
});

const beyondFileSchema = z.object({
  subject: z.string().min(1),
  for_grade: z.number().int(),
  items: z
    .array(
      z.object({
        term: z.string().min(1),
        patterns: z.array(z.string().min(1)).min(1),
        introduced_grade: z.number().int(),
        note: z.string().optional(),
        source: z.object({ book: z.string().min(1), lesson: z.string().min(1), official_url: z.url().nullable() }),
      }),
    )
    .nullable()
    .default([])
    .transform((v) => v ?? []),
});

export interface CurriculumLessonDef {
  lesson_id: string;
  subject: string;
  grade: number;
  seq: number;
  /** Tên tập sách ("Toán 5, Tập 1"), đã tra từ books[] — {curriculum_scope} và Guard SOURCE dùng tên. */
  book: string;
  topic: string | null;
  lesson_no: number;
  title: string;
  skill_ids: string[];
  introduces_terms: { term: string; patterns: string[] }[];
  methods: string[];
  source: { official_url: string; pages: string | null; imported_at: string | null; series: string };
}

export type BeyondScopeTermDef = z.infer<typeof beyondFileSchema>['items'][number] & { subject: string; for_grade: number };

export class CurriculumSeedError extends Error {
  constructor(readonly problems: string[]) {
    super(`Seed mục lục bị từ chối:\n- ${problems.join('\n- ')}`);
    this.name = 'CurriculumSeedError';
  }
}

function checkPatterns(where: string, patterns: string[], problems: string[]) {
  for (const p of patterns) {
    try {
      compileTermPattern(p);
    } catch (err) {
      problems.push(`${where}: ${err instanceof InvalidTermPatternError ? err.message : String(err)}`);
    }
  }
}

export interface ParsedCurriculum {
  lessons: CurriculumLessonDef[];
  warnings: string[];
}

/**
 * Đọc mục lục một lớp. `knownSkillIds`: skill có trong skill graph (để từ chối skill_ids lạ);
 * `gradeSkillIds`: skill có grade_introduced = lớp này (mỗi skill phải thuộc ít nhất một bài).
 */
export function parseCurriculumFile(
  file: string,
  text: string,
  options: { knownSkillIds: Set<string>; gradeSkillIds?: string[] },
): ParsedCurriculum {
  const top = curriculumFileSchema.safeParse(parse(text));
  if (!top.success) {
    throw new CurriculumSeedError(top.error.issues.map((i) => `${file} › ${i.path.join('.')}: ${i.message}`));
  }
  const { subject, grade, series, books } = top.data;
  const bookTitle = new Map(books.map((b) => [b.id, b.title]));
  const problems: string[] = [];
  const warnings: string[] = [];
  const lessons: CurriculumLessonDef[] = [];
  const ids = new Set<string>();
  const seqs = new Set<number>();

  top.data.lessons.forEach((raw, index) => {
    const label = String((raw as { lesson_id?: unknown })?.lesson_id ?? `lessons[${index}]`);
    const parsed = lessonSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((i) => `${file} › ${label} › ${i.path.join('.')}: ${i.message}`));
      return;
    }
    const l = parsed.data;
    const where = `${file} › ${l.lesson_id}`;
    if (ids.has(l.lesson_id)) problems.push(`${where}: lesson_id trùng`);
    ids.add(l.lesson_id);
    if (seqs.has(l.seq)) problems.push(`${where}: seq ${l.seq} trùng`);
    seqs.add(l.seq);
    const title = bookTitle.get(l.book);
    if (!title) problems.push(`${where}: book "${l.book}" không có trong books[]`);
    for (const s of l.skill_ids) if (!options.knownSkillIds.has(s)) problems.push(`${where}: skill_ids trỏ tới skill không tồn tại ${s}`);
    l.introduces_terms.forEach((t) => checkPatterns(`${where} › ${t.term}`, t.patterns, problems));
    if (!l.source.imported_at) warnings.push(`${where}: chưa có source.imported_at (chờ chủ dự án duyệt)`);
    lessons.push({
      ...l,
      subject,
      grade,
      book: title ?? l.book,
      source: { ...l.source, series },
    });
  });

  // seq liên tục từ 1: báo chỗ đứt đầu tiên.
  const sorted = [...seqs].sort((a, b) => a - b);
  const gap = sorted.findIndex((s, i) => s !== i + 1);
  if (gap >= 0) problems.push(`${file}: seq phải liên tục từ 1 (thiếu ${gap + 1}, gặp ${sorted[gap]})`);

  for (const skill of options.gradeSkillIds ?? []) {
    if (!lessons.some((l) => l.skill_ids.includes(skill))) problems.push(`${file}: skill ${skill} (lớp ${grade}) không thuộc bài nào`);
  }

  if (problems.length) throw new CurriculumSeedError(problems);

  // Pattern của bài sau không được khớp thuật ngữ đã học ở bài trước (vd. "phần trăm" ở Bài 10 vs Bài 36).
  const ordered = [...lessons].sort((a, b) => a.seq - b.seq);
  ordered.forEach((later, i) => {
    for (const earlier of ordered.slice(0, i)) {
      for (const t of earlier.introduces_terms) {
        const hits = findTermMatches(t.term, later.introduces_terms);
        if (hits.length) {
          warnings.push(
            `${file} › ${later.lesson_id}: pattern "${hits[0]!.pattern}" khớp thuật ngữ "${t.term}" đã học ở ${earlier.lesson_id} — sẽ chặn nhầm`,
          );
        }
      }
    }
  });

  return { lessons, warnings };
}

export function parseBeyondScopeFile(file: string, text: string): BeyondScopeTermDef[] {
  const parsed = beyondFileSchema.safeParse(parse(text));
  if (!parsed.success) {
    throw new CurriculumSeedError(parsed.error.issues.map((i) => `${file} › ${i.path.join('.')}: ${i.message}`));
  }
  const problems: string[] = [];
  parsed.data.items.forEach((item) => checkPatterns(`${file} › ${item.term}`, item.patterns, problems));
  if (problems.length) throw new CurriculumSeedError(problems);
  return parsed.data.items.map((item) => ({ ...item, subject: parsed.data.subject, for_grade: parsed.data.for_grade }));
}
