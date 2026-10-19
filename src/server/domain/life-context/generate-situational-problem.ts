import 'server-only';
import { z } from 'zod';
import type { Actor } from '@/server/dal/actor';
import { listContextsForSkills, recentContextUses } from '@/server/dal/life-contexts-dal';
import { createProblem } from '@/server/dal/problems-dal';
import type { StudentContext } from '@/server/dal/sessions-dal';
import { raiseSystemAlert } from '@/server/dal/system-alerts-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { CurriculumScope, ScopeLesson, ScopeSkill } from '@/server/domain/curriculum/scope';
import { countQuestions, normalizeNumber, numbersIn, splitSentences } from '@/server/domain/dialogue/hard-checks';
import { loadPreset } from '@/server/domain/dialogue/preset';
import { presolveProblem, type PresolveDependencies } from '@/server/domain/presolve/presolve';
import { callLlm, LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { fillVariables, renderTemplateText } from './fill-variables';
import { lifeContextTemplateSchema } from './life-context-schema';
import { selectContext } from './select-context';

// Sinh bài tình huống (SPEC §5b.3): code chọn context đã duyệt + điền số → LLM chỉ viết thành lời
// (contextualize/v1) → code kiểm số liệu, độ dài → Pre-solver + sympy như mọi bài. Fail → context khác,
// tối đa 3 lần. Cạn thư viện → system_alert, KHÔNG sinh bài trơn (quy tắc cứng 13).

export const CONTEXTUALIZE_PROMPT = 'contextualize/v1';
export const MAX_CONTEXT_ATTEMPTS = 3;

export interface SituationalProblemInput {
  studentId: string;
  sessionId: string;
  student: StudentContext;
  scope: CurriculumScope;
  catalog: { lessons: ScopeLesson[]; skills: ScopeSkill[] };
  targetSkillIds: string[];
  /** Bài gốc khi đây là bài tương tự ở PARALLEL. */
  parallelOf?: string | null;
  evalMode?: 'live' | 'eval';
  presolveDeps?: PresolveDependencies;
  random?: () => number;
}

export type SituationalProblemResult =
  | { ok: true; problemId: string; problemText: string; contextId: string; values: Record<string, string>; visual: SituationalVisual | null }
  | { ok: false; reason: 'context_pool_exhausted' | 'generation_failed'; tried: string[] };

/** Hình minh hoạ SVG cho đề tình huống (client vẽ bằng component math-visuals). */
export interface SituationalVisual {
  kind: 'segment_bar' | 'fraction_grid' | 'number_line' | 'box';
  items: { label: string; value: number; unit: string }[];
}

const BRAND = /\b(coca|pepsi|vinamilk|kfc|lotte|samsung|iphone|honda|yamaha|grab|shopee|lazada|tiki|circle ?k|highlands)\b/i;

/** Kiểm bằng code đề do LLM viết: đủ mọi số đã điền, không thêm số lạ, ≤ N câu, kết bằng câu hỏi. */
export function situationalTextProblems(text: string, values: Record<string, string>, maxSentences: number): string[] {
  const problems: string[] = [];
  const said = numbersIn(text);
  const expected = Object.values(values).map(normalizeNumber);
  for (const v of expected) if (!said.includes(v)) problems.push(`thiếu số ${v}`);
  const extra = said.filter((n) => !expected.includes(n));
  if (extra.length) problems.push(`thêm số không có trong khung: ${extra.join(', ')}`);
  if (splitSentences(text).length > maxSentences) problems.push(`quá ${maxSentences} câu`);
  if (!text.trim().endsWith('?') || countQuestions(text) !== 1) problems.push('câu cuối phải là câu hỏi duy nhất');
  if (BRAND.test(text)) problems.push('có tên nhãn hàng');
  if (/(?<![\d.,])\d+\.\d+/.test(text)) problems.push('số thập phân dấu chấm');
  return problems;
}

// Nhân vật luân phiên nam/nữ (cân bằng giới), không lấy tên con.
const CHARACTERS = ['bạn An', 'bạn Lan', 'bạn Minh', 'bạn Hoa', 'bạn Nam', 'bạn Mai', 'bạn Khôi', 'bạn Linh'];

export async function generateSituationalProblem(actor: Actor, input: SituationalProblemInput): Promise<SituationalProblemResult> {
  const preset = loadPreset(input.student.preset);
  const random = input.random ?? Math.random;
  const contexts = await listContextsForSkills(input.targetSkillIds);
  const recent = await recentContextUses(actor, { studentId: input.studentId });
  const prompt = await loadPrompt(CONTEXTUALIZE_PROMPT);
  const tried: string[] = [];

  for (let attempt = 1; attempt <= MAX_CONTEXT_ATTEMPTS; attempt++) {
    const choice = selectContext({
      contexts: contexts.map((c) => ({ ...c, approved: !!c.approved_by })),
      targetSkillIds: input.targetSkillIds,
      allowedSkillIds: input.scope.allowedSkillIds,
      grade: input.student.grade,
      interests: input.student.interests_declared,
      recentUses: recent,
      exclude: tried,
      random,
    });
    if (!choice.ok) {
      await raiseSystemAlert({
        type: 'context_pool_exhausted',
        severity: 'warning',
        detail: { skill_ids: input.targetSkillIds, tried },
        dedupeKey: `context_pool_exhausted:${input.targetSkillIds.join(',')}:${new Date().toISOString().slice(0, 10)}`,
      });
      return { ok: false, reason: tried.length ? 'generation_failed' : 'context_pool_exhausted', tried };
    }
    const row = contexts.find((c) => c.id === choice.context.id)!;
    tried.push(row.id);
    const template = lifeContextTemplateSchema.parse(row.template);
    let filled;
    try {
      filled = fillVariables(template, { random, thousands: preset.thousands_separator });
    } catch {
      continue;
    }

    let problemText: string;
    try {
      const r = await callLlm({
        purpose: 'contextualize',
        studentId: input.studentId,
        sessionId: input.sessionId,
        promptVersion: CONTEXTUALIZE_PROMPT,
        system: [
          {
            text: renderPrompt(prompt.content, {
              grade: input.student.grade,
              setup_filled: renderTemplateText(template.setup, filled.display),
              real_question: renderTemplateText(template.real_question, filled.display),
              values: Object.values(filled.display).join('; '),
              character: CHARACTERS[Math.floor(random() * CHARACTERS.length)]!,
              max_sentences: preset.max_sentences_situational,
              curriculum_scope: renderCurriculumScope(input.scope),
            }),
          },
        ],
        messages: [{ role: 'user', content: 'Viết đề.' }],
        responseSchema: z.object({ problem_text: z.string().min(1).max(600) }),
        mode: input.evalMode,
      });
      problemText = r.parsed!.problem_text.trim();
    } catch (err) {
      if (err instanceof LlmOutputInvalidError) continue;
      throw err;
    }
    if (situationalTextProblems(problemText, filled.values, preset.max_sentences_situational).length) continue;

    const problemId = await createProblem(actor, {
      studentId: input.studentId,
      sessionId: input.sessionId,
      origin: 'generated',
      confirmedText: problemText,
      confirmedByStudent: true,
      lifeContextId: row.id,
      contextVariables: { values: filled.values, answer: filled.answer, parallel_of: input.parallelOf ?? null },
    });
    const presolved = await presolveProblem(
      actor,
      {
        studentId: input.studentId,
        sessionId: input.sessionId,
        problemId,
        problemText,
        origin: 'generated',
        sessionScope: input.scope,
        catalog: input.catalog,
        mode: input.evalMode,
      },
      input.presolveDeps,
    );
    // Đáp án của Pre-solver phải khớp đáp án code đã tính khi điền biến.
    const agrees =
      presolved.ok &&
      (presolved.plan.final_answer.kind !== 'number' || normalizeNumber(String(presolved.plan.final_answer.canonical)) === normalizeNumber(filled.answer));
    if (presolved.ok && agrees) {
      const visual: SituationalVisual | null =
        template.svg_kind === 'none'
          ? null
          : {
              kind: template.svg_kind,
              items: Object.entries(filled.values).map(([k, v]) => ({ label: template.variables[k]!.label ?? k, value: Number(v), unit: template.variables[k]!.unit })),
            };
      return { ok: true, problemId, problemText, contextId: row.id, values: filled.values, visual };
    }
  }
  return { ok: false, reason: 'generation_failed', tried };
}
