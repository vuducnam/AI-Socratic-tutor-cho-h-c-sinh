import 'server-only';
import type { LlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import { subjectName } from '@/server/domain/curriculum/subject-config';
import type { CurriculumScope } from '@/server/domain/curriculum/scope';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { groundedLeakWords } from '@/lib/grounded-leak-words';
import type { Preset } from './preset';
import { guardOutputSchema, knowledgeGuardOutputSchema, type GuardOutput } from './tutor-output-schema';

// Guard (SPEC §8.2, §5d): model riêng kiểm mọi tin nhắn gửi con sau kiểm tra cứng. Môn kiến thức có prompt riêng
// (chỉ trang sách là đúng phương pháp; gợi bằng chữ của ý chính con chưa nói là lộ, model trích chữ lộ và code kiểm
// lại), Toán giữ nguyên guard/v11.
export const GUARD_PROMPT = 'guard/v11';
export const GUARD_KNOWLEDGE_PROMPT = 'guard_knowledge/v3';

export function guardPromptVersion(plan: SolutionPlan | null): string {
  return plan?.final_answer.kind === 'key_points' ? GUARD_KNOWLEDGE_PROMPT : GUARD_PROMPT;
}

export interface GuardInput {
  studentId: string;
  sessionId: string;
  /** Lượt sẽ chứa tin nhắn; null khi chưa chắc lượt được ghi (đề luyện có thể bị chặn, không có lượt nào). */
  turnId: string | null;
  message: string;
  studentMessage: string;
  /** Môn kiến thức: mọi lời con đã nói trong bài (Mít chỉ được nhắc lại chi tiết có ở đây). */
  studentTexts?: string[];
  /** Môn kiến thức: câu ý chính của bài, để code kiểm chữ lộ Guard trích ra. */
  keyFactStatements?: string[];
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

export interface GuardResult extends GuardOutput {
  llmCallId: string;
  /** Kết luận đúng như model trả (dòng guard_verdicts checker llm). verdict/reasons ở trên là kết luận sau cùng. */
  llm: Pick<GuardOutput, 'verdict' | 'reasons'>;
  /** Code bác LEAK vì chữ model trích không phải chữ của ý chính con chưa nói: lời trích đó; null nếu không bác. */
  ungroundedLeakQuotes: string[] | null;
}

export async function runGuard(input: GuardInput): Promise<GuardResult> {
  const promptVersion = guardPromptVersion(input.plan);
  const prompt = await loadPrompt(promptVersion);
  const system = renderPrompt(prompt.content, {
    student_said: input.studentTexts?.length ? input.studentTexts.join(' | ') : '(chưa nói gì)',
    grade: input.grade,
    subject_name: subjectName(input.scope.subject),
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
  const knowledge = promptVersion === GUARD_KNOWLEDGE_PROMPT;
  const result = await callLlm({
    purpose: 'guard',
    // Môn kiến thức chạy Guard bằng model mạnh hơn (config/models.yaml › guard_knowledge).
    role: knowledge ? 'guard_knowledge' : undefined,
    studentId: input.studentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    promptVersion,
    system: [{ text: system, cache: true }],
    messages: [{ role: 'user', content: `Tin nhắn cần kiểm:\n<message>${input.message}</message>` }],
    responseSchema: knowledge ? knowledgeGuardOutputSchema : guardOutputSchema,
    mode: input.evalMode,
    recorder: input.recorder,
  });
  const raw = result.parsed!;
  const llm = { verdict: raw.verdict, reasons: raw.reasons };
  // Môn kiến thức: LEAK chỉ đứng khi chữ model trích ra là chữ của ý chính con chưa nói (grounded-leak-words).
  const quotes = 'leak_quotes' in raw ? (raw.leak_quotes as string[]) : [];
  const ungrounded =
    knowledge &&
    raw.verdict === 'block' &&
    raw.reasons.includes('LEAK') &&
    groundedLeakWords({ quotes, message: input.message, statements: input.keyFactStatements ?? [], said: input.studentTexts ?? [], problemText: input.problemText }).length === 0;
  if (!ungrounded) return { verdict: raw.verdict, reasons: raw.reasons, explanation: raw.explanation, llmCallId: result.llmCallId, llm, ungroundedLeakQuotes: null };
  const reasons = raw.reasons.filter((r) => r !== 'LEAK');
  return {
    verdict: reasons.length ? 'block' : 'pass',
    reasons,
    explanation: reasons.length ? raw.explanation : '',
    llmCallId: result.llmCallId,
    llm,
    ungroundedLeakQuotes: quotes,
  };
}

export const UNGROUNDED_LEAK = 'LEAK_UNGROUNDED';

/**
 * Các dòng guard_verdicts cho một lần Guard: kết luận nguyên văn của model (checker llm); nếu code bác LEAK không
 * chỉ ra được chữ thì thêm một dòng checker code ghi kết luận sau cùng, để phụ huynh thấy rõ ai quyết định.
 */
export function guardVerdictRows(g: GuardResult): { checker: 'llm' | 'code'; llmCallId: string | null; verdict: 'pass' | 'block'; reasons: string[] }[] {
  const rows: { checker: 'llm' | 'code'; llmCallId: string | null; verdict: 'pass' | 'block'; reasons: string[] }[] = [
    { checker: 'llm', llmCallId: g.llmCallId, verdict: g.llm.verdict, reasons: g.llm.reasons },
  ];
  if (g.ungroundedLeakQuotes) rows.push({ checker: 'code', llmCallId: null, verdict: g.verdict, reasons: [UNGROUNDED_LEAK, ...g.reasons] });
  return rows;
}
