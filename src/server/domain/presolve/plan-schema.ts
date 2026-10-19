import 'server-only';
import { z } from 'zod';

// Output của presolve/v1 (SPEC §8.3, mở rộng): các bước có step_id, đáp án cuối, skill, misconception,
// và biểu thức kiểm cho math-verifier (cú pháp ở services/math-verifier/app/verify.py).
// Mỗi bước có `hint_question`: câu hỏi dự phòng khi Tutor bị Guard chặn 2 lần (phase 12).

export const planStepSchema = z.object({
  step_id: z.string().regex(/^s\d{1,2}$/, 'step_id dạng s1, s2…'),
  skill_id: z.string().min(1),
  description: z.string().min(1).max(400),
  expected_result: z.string().min(1).max(200),
  hint_question: z.string().min(1).max(200),
});

export const sympyCheckSchema = z.object({
  kind: z.enum(['number', 'number_list', 'relation', 'choice']),
  expression: z.string().min(1).max(500),
  expected: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).min(1).max(50)]),
});

export const solutionPlanSchema = z.object({
  steps: z.array(planStepSchema).min(1).max(12),
  final_answer: z.object({
    /** Cách viết cho người đọc (dấu phẩy thập phân), ví dụ "0,5 > 0,45". */
    value: z.string().min(1).max(200),
    /** Dạng máy, khớp sympy_check.expected (dấu chấm thập phân). */
    canonical: z.union([z.string().min(1).max(64), z.array(z.string().min(1).max(64)).min(1).max(50)]),
    kind: z.enum(['number', 'number_list', 'relation', 'choice']),
    /** Với choice: nhãn của lựa chọn đúng như trong đề (ví dụ tên bạn). */
    choice_label: z.string().max(100).nullable(),
  }),
  skill_ids: z.array(z.string().min(1)).min(1).max(8),
  misconception_ids: z.array(z.string()).max(8),
  sympy_check: sympyCheckSchema,
  /** Số liệu đề cho (để kiểm lộ đáp án không chặn nhầm số có sẵn trong đề). */
  given_numbers: z.array(z.string().max(32)).max(40),
});

export type SolutionPlan = z.infer<typeof solutionPlanSchema>;
export type PlanStep = z.infer<typeof planStepSchema>;

/** Kiểm nhất quán bằng code: đáp án cuối khớp biểu thức kiểm, step_id không trùng, skill bước ⊆ skill_ids. */
export function planConsistencyProblems(plan: SolutionPlan): string[] {
  const problems: string[] = [];
  const same = JSON.stringify(plan.final_answer.canonical) === JSON.stringify(plan.sympy_check.expected);
  if (!same) problems.push('final_answer.canonical khác sympy_check.expected');
  if (plan.final_answer.kind !== plan.sympy_check.kind) problems.push('final_answer.kind khác sympy_check.kind');
  const ids = plan.steps.map((s) => s.step_id);
  if (new Set(ids).size !== ids.length) problems.push('step_id trùng');
  for (const s of plan.steps) {
    if (!plan.skill_ids.includes(s.skill_id)) problems.push(`bước ${s.step_id} dùng skill ${s.skill_id} không có trong skill_ids`);
  }
  if (plan.final_answer.kind === 'choice' && !plan.final_answer.choice_label) problems.push('choice cần choice_label');
  return problems;
}
