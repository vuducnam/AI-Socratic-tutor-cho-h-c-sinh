import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

// Bộ đề nghiệm thu tự soạn (không chép SGK) — chỉ ở máy, không trên GitHub. Đường dẫn: EVAL_PROBLEMS_DIR
// (mặc định eval/problems). Đáp án tham chiếu `answer.machine` do script tính, không do model.

export const acceptanceProblemSchema = z.object({
  id: z.string(),
  target_lesson_id: z.string(),
  kind: z.string(),
  origin: z.enum(['homework', 'generated']),
  text: z.string().min(1),
  answer: z.object({ display: z.string(), machine: z.array(z.string()).min(1) }),
  skill_ids: z.array(z.string()).default([]),
});

export type AcceptanceProblem = z.infer<typeof acceptanceProblemSchema>;

/** Đề của môn `subject` (khoá `subject` đầu file; file không ghi môn coi là Toán). */
export function loadAcceptanceProblems(dir = process.env.EVAL_PROBLEMS_DIR ?? 'eval/problems', subject = process.env.EVAL_SUBJECT ?? 'math'): AcceptanceProblem[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.yaml')) files.push(join(d, e.name));
    }
  };
  walk(dir);
  return files.flatMap((f) => {
    const doc = parse(readFileSync(f, 'utf8')) as { subject?: string; problems?: unknown[] };
    if ((doc.subject ?? 'math') !== subject) return [];
    return (doc.problems ?? []).map((p) => acceptanceProblemSchema.parse(p));
  });
}
