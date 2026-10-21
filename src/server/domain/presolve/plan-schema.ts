import 'server-only';
import { z } from 'zod';

// Output của presolve/v1 (SPEC §8.3, mở rộng): các bước có step_id, đáp án cuối, skill, misconception,
// và biểu thức kiểm cho math-verifier (cú pháp ở services/math-verifier/app/verify.py).
// Mỗi bước có `hint_question`: câu hỏi dự phòng khi Tutor bị Guard chặn 2 lần (phase 12).
//
// Hai schema: `mathPlanOutputSchema` là đúng đầu ra model Toán (gửi làm JSON schema cho presolve/v1, không đổi);
// `solutionPlanSchema` là plan đã lưu, gồm cả môn kiến thức (SPEC §5d): final_answer.kind = key_points, không có
// sympy_check, mỗi bước gắn fact_ids (ý chính đã duyệt).

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

export const mathPlanOutputSchema = z.object({
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

export const knowledgePlanSchema = z.object({
  question_type: z.enum(['fact', 'explain', 'opinion']),
  required_fact_ids: z.array(z.string().min(1)).max(12),
  min_required: z.number().int().min(0).max(12),
  context_fact_ids: z.array(z.string().min(1)).max(12),
});

/** Plan đã lưu (solution_plans.plan) của mọi môn. */
export const solutionPlanSchema = mathPlanOutputSchema.extend({
  steps: z.array(planStepSchema.extend({ fact_ids: z.array(z.string().min(1)).max(6).optional() })).min(1).max(12),
  final_answer: mathPlanOutputSchema.shape.final_answer.extend({
    kind: z.enum(['number', 'number_list', 'relation', 'choice', 'key_points']),
  }),
  /** Toán: biểu thức cho math-verifier. Môn kiến thức: null (kiểm bằng ý chính). */
  sympy_check: sympyCheckSchema.nullable(),
  /** Chỉ môn kiến thức (final_answer.kind = key_points). */
  knowledge: knowledgePlanSchema.nullable().optional(),
});

export type SolutionPlan = z.infer<typeof solutionPlanSchema>;
export type PlanStep = z.infer<typeof solutionPlanSchema>['steps'][number];
export type KnowledgePlan = z.infer<typeof knowledgePlanSchema>;

/** Kiểm nhất quán bằng code: đáp án cuối khớp biểu thức kiểm, step_id không trùng, skill bước ⊆ skill_ids. */
export function planConsistencyProblems(plan: SolutionPlan): string[] {
  if (plan.final_answer.kind === 'key_points') return knowledgeConsistencyProblems(plan);
  if (!plan.sympy_check) return ['thiếu sympy_check'];
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

/** Kế hoạch môn kiến thức: đủ ý bắt buộc theo loại câu hỏi, bước chỉ trỏ tới ý đã khai, step_id không trùng. */
function knowledgeConsistencyProblems(plan: SolutionPlan): string[] {
  const k = plan.knowledge;
  if (!k) return ['key_points cần knowledge'];
  const problems: string[] = [];
  if (plan.sympy_check) problems.push('key_points không dùng sympy_check');
  if (k.question_type === 'opinion') {
    if (k.min_required !== 0) problems.push('câu opinion không bắt buộc ý nào (min_required = 0)');
  } else {
    if (!k.required_fact_ids.length) problems.push('câu fact/explain cần ít nhất một ý bắt buộc');
    if (k.min_required < 1 || k.min_required > k.required_fact_ids.length) problems.push('min_required phải từ 1 tới số ý bắt buộc');
  }
  const declared = new Set([...k.required_fact_ids, ...k.context_fact_ids]);
  const ids = plan.steps.map((s) => s.step_id);
  if (new Set(ids).size !== ids.length) problems.push('step_id trùng');
  for (const s of plan.steps) {
    for (const f of s.fact_ids ?? []) if (!declared.has(f)) problems.push(`bước ${s.step_id} dùng ý ${f} không có trong required/context`);
  }
  return problems;
}
