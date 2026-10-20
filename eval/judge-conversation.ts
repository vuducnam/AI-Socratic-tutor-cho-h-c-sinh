import { z } from 'zod';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import type { JudgeResult } from './metrics';

// Judge LLM chấm một hội thoại eval (prompts/eval_judge/v3.md). Dùng API đồng bộ, key eval, không fallback.
export const JUDGE_PROMPT = 'eval_judge/v3';

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

// Đánh số sẵn các dòng CU ("CU 3: ...") để leak_turns/out_of_scope_turns trỏ đúng tin nhắn:
// để judge tự đếm thì có lúc lệch một lượt.
export function formatJudgeTranscript(transcript: { role: 'CU' | 'HS'; text: string }[]): string {
  let cu = 0;
  return transcript.map((t) => (t.role === 'CU' ? `CU ${++cu}: ${t.text}` : `HS: ${t.text}`)).join('\n');
}

export async function judgeConversation(input: {
  sessionId: string;
  grade: number;
  problemText: string;
  finalAnswer: string;
  scope: CurriculumScope;
  persona: string;
  transcript: { role: 'CU' | 'HS'; text: string }[];
}): Promise<JudgeResult> {
  const prompt = await loadPrompt(JUDGE_PROMPT);
  const system = renderPrompt(prompt.content, {
    grade: input.grade,
    problem_text: input.problemText,
    final_answer: input.finalAnswer,
    curriculum_scope: renderCurriculumScope(input.scope),
    persona: input.persona,
    transcript: formatJudgeTranscript(input.transcript),
  });
  const r = await callLlm({
    purpose: 'eval_judge',
    role: 'judge',
    sessionId: input.sessionId,
    promptVersion: JUDGE_PROMPT,
    system: [{ text: system }],
    messages: [{ role: 'user', content: 'Chấm cuộc trò chuyện.' }],
    responseSchema: judgeSchema,
    mode: 'eval',
  });
  return r.parsed!;
}
