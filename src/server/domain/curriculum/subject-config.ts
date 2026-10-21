import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

// Danh sách môn (config/subjects.yaml, SPEC §1.2, §5d): một nguồn duy nhất cho tên môn, cách kiểm đáp án và
// bàn phím toán. Code không cố định môn nào; môn chỉ mở được khi bố mẹ đã đặt tiến độ (quy tắc cứng 15).

const subjectSchema = z.object({
  id: z.string().regex(/^[a-z][a-z_-]*$/),
  name: z.string().min(1),
  verifier: z.enum(['sympy', 'key_facts']),
  math_keyboard: z.boolean(),
});

const fileSchema = z
  .object({ subjects: z.array(subjectSchema).min(1) })
  .refine((f) => new Set(f.subjects.map((s) => s.id)).size === f.subjects.length, { message: 'trùng id môn' });

export type SubjectConfig = z.infer<typeof subjectSchema>;

let cache: SubjectConfig[] | null = null;

export function parseSubjectsYaml(text: string): SubjectConfig[] {
  return fileSchema.parse(parse(text)).subjects;
}

export function loadSubjects(): SubjectConfig[] {
  // CU_SUBJECTS_CONFIG: chỉ test dùng (danh sách môn giả); app luôn đọc config/subjects.yaml.
  const file = process.env.CU_SUBJECTS_CONFIG ?? 'config/subjects.yaml';
  cache ??= parseSubjectsYaml(readFileSync(resolve(/*turbopackIgnore: true*/ process.cwd(), file), 'utf8'));
  return cache;
}

export function findSubject(id: string): SubjectConfig | null {
  return loadSubjects().find((s) => s.id === id) ?? null;
}

/** Tên hiển thị của môn; môn không còn trong config thì hiện mã môn (dữ liệu cũ vẫn xem được). */
export function subjectName(id: string): string {
  return findSubject(id)?.name ?? id;
}

/** Môn trong config; id lạ → lỗi (route đã validate bằng zod, đây là chốt chặn cuối). */
export function requireSubject(id: string): SubjectConfig {
  const subject = findSubject(id);
  if (!subject) throw new Error(`Môn không có trong config/subjects.yaml: ${id}`);
  return subject;
}
