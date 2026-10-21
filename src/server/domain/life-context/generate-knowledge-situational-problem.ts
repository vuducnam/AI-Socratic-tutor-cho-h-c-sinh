import 'server-only';
import { z } from 'zod';
import { matchedPhrase } from '@/lib/key-point-matcher';
import type { Actor } from '@/server/dal/actor';
import { listKeyFactsByIds, type KeyFactRow } from '@/server/dal/key-facts-dal';
import { listContextsForSkills, recentContextUses } from '@/server/dal/life-contexts-dal';
import { createProblem } from '@/server/dal/problems-dal';
import { raiseSystemAlert } from '@/server/dal/system-alerts-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import { subjectName } from '@/server/domain/curriculum/subject-config';
import { countQuestions, splitSentences } from '@/server/domain/dialogue/hard-checks';
import { factsBeyondQuestion } from '@/server/domain/dialogue/key-points-progress';
import { loadPreset } from '@/server/domain/dialogue/preset';
import { presolveProblem } from '@/server/domain/presolve/presolve';
import { callLlm, LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { BRAND, CHARACTERS, MAX_CONTEXT_ATTEMPTS, type SituationalProblemInput, type SituationalProblemResult } from './generate-situational-problem';
import { isKnowledgeTemplate, knowledgeContextTemplateSchema } from './life-context-schema';
import { selectContext } from './select-context';

// Đề tình huống môn kiến thức (SPEC §5b.3, §5d; quy tắc cứng 13): code chọn tình huống đã duyệt (mẫu không số,
// gắn ý chính đã duyệt) → LLM chỉ viết thành lời (contextualize_knowledge/v1) → code kiểm đề không lộ ý chính →
// Pre-solver kiến thức; ý bắt buộc của plan phải nằm trong ý chính của tình huống. Fail → tình huống khác, tối đa 3
// lần. Cạn thư viện → system_alert, không bao giờ sinh câu hỏi trơn.

export const CONTEXTUALIZE_KNOWLEDGE_PROMPT = 'contextualize_knowledge/v1';

/** Kiểm bằng code đề do LLM viết: ≤ N câu, đúng một câu hỏi ở cuối, không nhãn hàng, không lộ ý chính. */
export function knowledgeSituationalTextProblems(text: string, facts: KeyFactRow[], templateText: string, maxSentences: number): string[] {
  const problems: string[] = [];
  if (splitSentences(text).length > maxSentences) problems.push(`quá ${maxSentences} câu`);
  if (!text.trim().endsWith('?') || countQuestions(text) !== 1) problems.push('câu cuối phải là câu hỏi duy nhất');
  if (BRAND.test(text)) problems.push('có tên nhãn hàng');
  // Cụm có sẵn trong khung đã duyệt thì được dùng; cụm khác của ý chính xuất hiện là lộ điều con phải tự tìm.
  for (const f of factsBeyondQuestion(facts, templateText)) {
    const phrase = matchedPhrase(text, f);
    if (phrase) problems.push(`lộ ý chính ${f.fact_id} («${phrase}»)`);
  }
  return problems;
}

export async function generateKnowledgeSituationalProblem(actor: Actor, input: SituationalProblemInput): Promise<SituationalProblemResult> {
  const preset = loadPreset(input.student.preset);
  const random = input.random ?? Math.random;
  const contexts = (await listContextsForSkills(input.targetSkillIds)).filter((c) => isKnowledgeTemplate(c.template));
  const recent = await recentContextUses(actor, { studentId: input.studentId });
  const prompt = await loadPrompt(CONTEXTUALIZE_KNOWLEDGE_PROMPT);
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
    const template = knowledgeContextTemplateSchema.parse(row.template);
    // Ý chính của tình huống phải còn được duyệt (bài sửa sau khi duyệt thì tạm không dùng).
    const facts = await listKeyFactsByIds(template.fact_ids);
    if (facts.length !== template.fact_ids.length) continue;

    let problemText: string;
    try {
      const r = await callLlm({
        purpose: 'contextualize',
        studentId: input.studentId,
        sessionId: input.sessionId,
        promptVersion: CONTEXTUALIZE_KNOWLEDGE_PROMPT,
        system: [
          {
            text: renderPrompt(prompt.content, {
              grade: input.student.grade,
              subject_name: subjectName(input.scope.subject),
              setup: template.setup,
              real_question: template.real_question,
              character: CHARACTERS[Math.floor(random() * CHARACTERS.length)]!,
              secret_facts: facts.map((f) => `- ${f.statement}`).join('\n'),
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
    if (knowledgeSituationalTextProblems(problemText, facts, `${template.setup} ${template.real_question}`, preset.max_sentences_situational).length) continue;

    const problemId = await createProblem(actor, {
      studentId: input.studentId,
      sessionId: input.sessionId,
      origin: 'generated',
      confirmedText: problemText,
      confirmedByStudent: true,
      lifeContextId: row.id,
      contextVariables: { values: {}, fact_ids: template.fact_ids, parallel_of: input.parallelOf ?? null },
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
    // Kế hoạch phải kiểm đúng các ý chính mà tình huống đã duyệt nhắm tới.
    const agrees =
      presolved.ok &&
      !!presolved.plan.knowledge &&
      presolved.plan.knowledge.required_fact_ids.length > 0 &&
      presolved.plan.knowledge.required_fact_ids.every((id) => template.fact_ids.includes(id));
    if (presolved.ok && agrees) return { ok: true, problemId, problemText, contextId: row.id, values: {}, visual: null };
  }
  return { ok: false, reason: 'generation_failed', tried };
}
