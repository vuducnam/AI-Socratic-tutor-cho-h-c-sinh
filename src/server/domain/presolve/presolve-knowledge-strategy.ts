import 'server-only';
import { z } from 'zod';
import { listApprovedKeyFacts, type KeyFactRow } from '@/server/dal/key-facts-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { ScopeLesson } from '@/server/domain/curriculum/scope';
import { findSubject } from '@/server/domain/curriculum/subject-config';
import { factsBeyondQuestion } from '@/server/domain/dialogue/key-points-progress';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { planConsistencyProblems, planStepSchema, type SolutionPlan } from './plan-schema';
import type { PresolveStrategy } from './presolve-strategy';

// Pre-solver môn kiến thức (SPEC §5d): model lập kế hoạch dẫn dắt CHỈ từ ý chính đã duyệt (mọi bài cùng lớp, đánh
// dấu đã học/chưa học để vòng lặp chung xử lý bài về nhà vượt tiến độ); code đổi ý chính → skill của bài và kiểm:
// mọi fact_id có thật và đã duyệt, đủ ý theo loại câu hỏi, ý bắt buộc còn chấm được sau khi bỏ cụm có sẵn trong đề.

export const PRESOLVE_KNOWLEDGE_PROMPT = 'presolve_knowledge/v1';

export const knowledgePlanOutputSchema = z.object({
  not_covered: z.boolean(),
  not_covered_reason: z.string().max(300).nullable(),
  question_type: z.enum(['fact', 'explain', 'opinion']),
  steps: z
    .array(planStepSchema.omit({ skill_id: true }).extend({ fact_ids: z.array(z.string().min(1)).min(1).max(3) }))
    .max(12),
  required_fact_ids: z.array(z.string().min(1)).max(12),
  min_required: z.number().int().min(0).max(12),
  context_fact_ids: z.array(z.string().min(1)).max(12),
  summary: z.string().min(1).max(400),
});

type KnowledgeOutput = z.infer<typeof knowledgePlanOutputSchema>;

// Tóm tắt chỉ để hệ thống và bố mẹ xem; plan giữ tối đa 200 ký tự (final_answer.value) nên cắt ở ranh giới từ.
const SUMMARY_MAX = 200;
export function fitSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX) return summary;
  const cut = summary.slice(0, SUMMARY_MAX - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

/** Đổi đầu ra của model thành plan đã lưu: skill của ý chính = skill của bài chứa ý đó (mục lục). */
export function knowledgeOutputToPlan(out: KnowledgeOutput, facts: Map<string, KeyFactRow>, lessons: ScopeLesson[]): SolutionPlan | string {
  const skillOf = (factId: string) => {
    const lessonId = facts.get(factId)?.lesson_id;
    return lessons.find((l) => l.lesson_id === lessonId)?.skill_ids[0] ?? null;
  };
  const allIds = [...new Set([...out.required_fact_ids, ...out.context_fact_ids, ...out.steps.flatMap((s) => s.fact_ids)])];
  const unknown = allIds.filter((id) => !facts.has(id));
  if (unknown.length) return `ý chính không có trong danh sách: ${unknown.join(', ')}`;
  const skillIds = [...new Set(allIds.map(skillOf).filter((s): s is string => !!s))];
  if (!skillIds.length || !out.steps.length) return 'cần ít nhất một bước gắn ý chính của bài';
  return {
    steps: out.steps.map((s) => ({ ...s, skill_id: skillOf(s.fact_ids[0]!) ?? skillIds[0]! })),
    final_answer: { value: fitSummary(out.summary), canonical: out.required_fact_ids.length ? out.required_fact_ids : ['opinion'], kind: 'key_points', choice_label: null },
    skill_ids: skillIds,
    misconception_ids: [],
    sympy_check: null,
    given_numbers: [],
    knowledge: {
      question_type: out.question_type,
      required_fact_ids: out.required_fact_ids,
      min_required: out.min_required,
      context_fact_ids: out.context_fact_ids,
    },
  };
}

export function knowledgeStrategy(): PresolveStrategy {
  // Ý chính đã đưa vào prompt lần gần nhất (để đổi đầu ra và kiểm trong cùng lượt Pre-solver).
  let facts = new Map<string, KeyFactRow>();
  let lessons: ScopeLesson[] = [];

  return {
    promptVersion: PRESOLVE_KNOWLEDGE_PROMPT,

    async system(scope, catalog) {
      const prompt = await loadPrompt(PRESOLVE_KNOWLEDGE_PROMPT);
      lessons = catalog.lessons.filter((l) => l.subject === scope.subject && l.grade === scope.grade).sort((a, b) => a.seq - b.seq);
      const rows = await listApprovedKeyFacts(lessons.map((l) => l.lesson_id));
      facts = new Map(rows.map((r) => [r.fact_id, r]));
      const allowed = new Set(scope.allowedSkillIds);
      const blocks = lessons
        .filter((l) => rows.some((r) => r.lesson_id === l.lesson_id))
        .map((l) => {
          const learned = l.skill_ids.length > 0 && l.skill_ids.every((s) => allowed.has(s));
          const lines = rows.filter((r) => r.lesson_id === l.lesson_id).map((r) => `- ${r.fact_id} | ${r.statement} | tr.${r.pages}`);
          return `## Bài ${l.lesson_id.split('.B')[1]}. ${l.title} (${learned ? 'đã học' : 'CHƯA HỌC trên lớp'})\n${lines.join('\n')}`;
        });
      const text = renderPrompt(prompt.content, {
        grade: scope.grade,
        subject_name: findSubject(scope.subject)?.name ?? scope.subject,
        curriculum_scope: renderCurriculumScope(scope),
        key_facts: blocks.length ? blocks.join('\n\n') : '(chưa có bài nào được duyệt ý chính)',
      });
      return { text, misconceptionIds: new Set<string>() };
    },

    async generate(systemText, call) {
      const result = await callLlm({
        purpose: 'presolve',
        studentId: call.studentId,
        sessionId: call.sessionId,
        promptVersion: PRESOLVE_KNOWLEDGE_PROMPT,
        system: [{ text: systemText, cache: true }],
        messages: [{ role: 'user', content: call.userContent }],
        responseSchema: knowledgePlanOutputSchema,
        mode: call.mode,
        recorder: call.recorder,
      });
      const out = result.parsed!;
      if (out.not_covered) return { kind: 'not_covered', reason: out.not_covered_reason ?? 'không có trong ý chính đã duyệt', llmCallId: result.llmCallId };
      const plan = knowledgeOutputToPlan(out, facts, lessons);
      if (typeof plan === 'string') return { kind: 'invalid', reason: plan, llmCallId: result.llmCallId };
      return { kind: 'plan', plan, llmCallId: result.llmCallId };
    },

    async verify(plan, problemText) {
      const problems = [...planConsistencyProblems(plan), ...(plan.knowledge ? [] : ['thiếu knowledge'])];
      // Ý bắt buộc mà mọi cụm chấp nhận đều có sẵn trong đề thì code không chấm được → chọn ý khác.
      const required = (plan.knowledge?.required_fact_ids ?? []).map((id) => facts.get(id)).filter((f): f is KeyFactRow => !!f);
      const unmatchable = factsBeyondQuestion(required, problemText).filter((f) => !f.accept.length).map((f) => f.fact_id);
      if (unmatchable.length) problems.push(`ý bắt buộc đã nằm sẵn trong đề, không dùng để chấm: ${unmatchable.join(', ')}`);
      return {
        verified: problems.length === 0,
        output: { checker: 'key_facts', problems, fact_ids: [...new Set([...(plan.knowledge?.required_fact_ids ?? []), ...(plan.knowledge?.context_fact_ids ?? [])])] },
        feedback: problems.join('; '),
      };
    },
  };
}

