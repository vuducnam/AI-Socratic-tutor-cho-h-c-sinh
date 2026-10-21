import 'server-only';
import type { LlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import type { Preset } from './preset';
import { guardOutputSchema, type GuardOutput } from './tutor-output-schema';

// Guard (guard/v10, SPEC §8.2): model riêng kiểm mọi tin nhắn gửi con sau kiểm tra cứng.
export const GUARD_PROMPT = 'guard/v10';

export interface GuardInput {
  studentId: string;
  sessionId: string;
  /** Lượt sẽ chứa tin nhắn; null khi chưa chắc lượt được ghi (đề luyện có thể bị chặn, không có lượt nào). */
  turnId: string | null;
  message: string;
  studentMessage: string;
  /** Tên Cú gọi học sinh (address.student hoặc tên hiển thị), để Guard không coi đó là nhân vật lạ. */
  studentName: string;
  /** Loại tin nhắn đang kiểm; mặc định lời Tutor. */
  messageKind?: 'tutor' | 'hook' | 'transfer_question' | 'parallel_problem' | 'practice_problem';
  grade: number;
  preset: Preset;
  scope: CurriculumScope;
  plan: SolutionPlan | null;
  problemText: string;
  origin: string;
  completedSteps: string[];
  skillSource: string;
  mode: 'solve' | 'argue';
  state: string;
  evalMode?: 'live' | 'eval';
  recorder?: LlmCallRecorder;
}

export async function runGuard(input: GuardInput): Promise<GuardOutput & { llmCallId: string }> {
  const prompt = await loadPrompt(GUARD_PROMPT);
  const system = renderPrompt(prompt.content, {
    grade: input.grade,
    problem_text: input.problemText,
    origin: input.origin,
    final_answer: input.plan ? `${input.plan.final_answer.value}` : '(bài mở, không có đáp án cố định)',
    plan_steps: input.plan ? input.plan.steps.map((s) => `${s.step_id}: ${s.description} → ${s.expected_result}`).join('; ') : '(không có)',
    completed_steps: input.completedSteps.length ? input.completedSteps.join(', ') : '(chưa có)',
    skill_source: input.skillSource,
    curriculum_scope: renderCurriculumScope(input.scope),
    mode: input.mode,
    state: input.state,
    student_name: input.studentName,
    message_kind: input.messageKind ?? 'tutor',
    student_message: input.studentMessage || '(chưa có)',
    max_sentences: input.preset.max_sentences,
    max_words_per_turn: input.preset.max_words_per_turn,
    max_questions_per_turn: input.preset.max_questions_per_turn,
    max_sentences_situational: input.preset.max_sentences_situational,
  });
  const result = await callLlm({
    purpose: 'guard',
    studentId: input.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    promptVersion: GUARD_PROMPT,
    system: [{ text: system, cache: true }],
    messages: [{ role: 'user', content: `Tin nhắn cần kiểm:\n<message>${input.message}</message>` }],
    responseSchema: guardOutputSchema,
    mode: input.evalMode,
    recorder: input.recorder,
  });
  return { ...result.parsed!, llmCallId: result.llmCallId };
}
