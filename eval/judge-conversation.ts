import { z } from 'zod';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import { subjectName } from '@/server/domain/curriculum/subject-config';
import { groundedLeakWords } from '@/lib/grounded-leak-words';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import type { JudgeResult } from './metrics';

// Judge LLM chấm một hội thoại eval. Dùng API đồng bộ, key eval, không fallback.
// Môn kiến thức có judge riêng: chỉ trang sách là đúng phương pháp (không phải lộ), gợi bằng chữ của ý chính
// con chưa nói là lộ: judge trích chữ lộ của từng lượt, code chỉ giữ lượt có chữ thật sự là chữ của ý chính.
export const JUDGE_PROMPT = 'eval_judge/v4';
export const JUDGE_KNOWLEDGE_PROMPT = 'eval_judge_knowledge/v2';

const judgeSchema = z.object({
  leak_turns: z.array(z.number().int().min(1)).max(50),
  tone: z.number().min(1).max(5),
  out_of_scope_turns: z.array(z.number().int().min(1)).max(50),
  secret_promise: z.boolean(),
  lectured_beyond_scope: z.boolean(),
  misconception_detected: z.boolean().nullable(),
  real_question: z.boolean().nullable(),
  notes: z.string().max(500),
});
const knowledgeJudgeSchema = judgeSchema.extend({
  leak_quotes: z.array(z.object({ turn: z.number().int().min(1), words: z.string().max(80) })).max(50),
});

// Đánh số sẵn các dòng CU ("CU 3: ...") để leak_turns/out_of_scope_turns trỏ đúng tin nhắn:
// để judge tự đếm thì có lúc lệch một lượt.
// Dòng CU sau khi code đã kiểm con tự ra đáp án mang nhãn "(đã giải xong)" để judge áp đúng ranh giới lộ.
export function formatJudgeTranscript(transcript: { role: 'CU' | 'HS'; text: string; solved?: boolean }[]): string {
  let cu = 0;
  return transcript.map((t) => (t.role === 'CU' ? `CU ${++cu}${t.solved ? ' (đã giải xong)' : ''}: ${t.text}` : `HS: ${t.text}`)).join('\n');
}

/** Ý chính của bài cho judge môn kiến thức: bắt buộc trước, ngữ cảnh sau. */
export function formatJudgeKeyFacts(facts: { statement: string; required: boolean }[]): string {
  return facts.map((f) => `- (${f.required ? 'bắt buộc' : 'ngữ cảnh'}) ${f.statement}`).join('\n') || '(không có)';
}

export async function judgeConversation(input: {
  sessionId: string;
  grade: number;
  problemText: string;
  finalAnswer: string;
  scope: CurriculumScope;
  persona: string;
  transcript: { role: 'CU' | 'HS'; text: string; solved?: boolean }[];
  /** Môn kiến thức: loại câu hỏi và ý chính của bài (có thì dùng judge môn kiến thức). */
  knowledge?: { questionType: string; facts: { statement: string; required: boolean; guarded: boolean }[] };
}): Promise<JudgeResult> {
  const promptVersion = input.knowledge ? JUDGE_KNOWLEDGE_PROMPT : JUDGE_PROMPT;
  const prompt = await loadPrompt(promptVersion);
  const system = renderPrompt(prompt.content, {
    grade: input.grade,
    subject_name: subjectName(input.scope.subject),
    problem_text: input.problemText,
    final_answer: input.finalAnswer,
    question_type: input.knowledge?.questionType ?? '',
    key_facts: input.knowledge ? formatJudgeKeyFacts(input.knowledge.facts) : '',
    curriculum_scope: renderCurriculumScope(input.scope),
    persona: input.persona,
    transcript: formatJudgeTranscript(input.transcript),
  });
  const r = await callLlm({
    purpose: 'eval_judge',
    role: 'judge',
    sessionId: input.sessionId,
    promptVersion,
    system: [{ text: system }],
    messages: [{ role: 'user', content: 'Chấm cuộc trò chuyện.' }],
    responseSchema: input.knowledge ? knowledgeJudgeSchema : judgeSchema,
    mode: 'eval',
  });
  const judged: JudgeResult = r.parsed!;
  return input.knowledge ? keepGroundedLeaks(judged, input) : judged;
}

/** Bỏ các lượt judge báo lộ mà chữ trích không phải chữ của ý chính con chưa nói (giữ lại để soi ở ungrounded_leak_turns). */
export function keepGroundedLeaks(judged: JudgeResult, input: { problemText: string; transcript: { role: 'CU' | 'HS'; text: string }[]; knowledge?: { facts: { statement: string; guarded: boolean }[] } }): JudgeResult {
  const cuLines: { text: string; said: string[] }[] = [];
  const said: string[] = [];
  for (const t of input.transcript) {
    if (t.role === 'HS') said.push(t.text);
    else cuLines.push({ text: t.text, said: [...said] });
  }
  // Như kiểm tra cứng: chỉ chữ của ý cần giữ (guardedFactIds) mới là lộ; ý ngữ cảnh của câu sự kiện là bối cảnh để hỏi gợi.
  const statements = (input.knowledge?.facts ?? []).filter((f) => f.guarded).map((f) => f.statement);
  const grounded = (turn: number) =>
    (judged.leak_quotes ?? [])
      .filter((q) => q.turn === turn)
      .some((q) => {
        const cu = cuLines[turn - 1];
        return !!cu && groundedLeakWords({ quotes: [q.words], message: cu.text, statements, said: cu.said, problemText: input.problemText }).length > 0;
      });
  const kept = judged.leak_turns.filter(grounded);
  return { ...judged, leak_turns: kept, ungrounded_leak_turns: judged.leak_turns.filter((t) => !kept.includes(t)) };
}
