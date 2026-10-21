import 'server-only';
import type { TurnWriter } from '@/server/dal/turns-dal';
import type { ChatMessage } from '@/server/llm/llm-types';
import { callLlm, LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { GENERIC_FALLBACK, planFallbackQuestion } from './fallback-question';
import { runGuard, type GuardInput } from './guard';
import { runHardChecks, type HardCheckContext } from './hard-checks';
import { buildTutorSystem, tutorPromptVersion, type TutorPromptInput } from './tutor-prompt';
import { tutorConversationMessages, type BlockedDraft } from './tutor-conversation-messages';
import { draftCandidates } from './tutor-draft-candidates';
import { tutorOutputSchema, type TutorOutput } from './tutor-output-schema';

// Sinh một tin nhắn của Cú qua đủ các lớp (SPEC §6 bước 4–6):
// Tutor → kiểm tra cứng bằng code → Guard → block thì Tutor sửa bản nháp kèm lý do (tối đa 3 lần viết) → vẫn block thì câu hỏi
// dự phòng của bước hiện tại (vẫn qua kiểm tra cứng) → vẫn fail thì câu chung đã duyệt. Lượt chat không
// bao giờ treo. Mọi lần kiểm ghi guard_verdicts (checker 'code' hoặc 'llm').

export interface GenerateInput {
  studentId: string;
  sessionId: string;
  tutorTurnId: string;
  history: ChatMessage[];
  prompt: TutorPromptInput;
  hardChecks: HardCheckContext;
  guard: Omit<GuardInput, 'message' | 'turnId' | 'recorder' | 'studentId' | 'sessionId'>;
  writer: TurnWriter;
  evalMode?: 'live' | 'eval';
}

export interface GeneratedMessage {
  message: string;
  source: 'tutor' | 'fallback' | 'generic';
  output: TutorOutput | null;
  tutorLlmCallId: string | null;
  blockedReasons: string[];
  guardSafety: boolean;
  attempts: number;
}

// Ba lần viết: lần 2 và 3 sửa bản nháp bị chặn (thường chỉ dư vài từ) trước khi rơi về câu dự phòng.
const MAX_TUTOR_ATTEMPTS = 3;

export async function generateTutorMessage(input: GenerateInput): Promise<GeneratedMessage> {
  const system = await buildTutorSystem(input.prompt);
  const blocked: string[] = [];
  let guardSafety = false;
  let blockedDraft: BlockedDraft | null = null;

  const verdict = (row: { checker: 'code' | 'llm'; llmCallId: string | null; tutorLlmCallId: string | null; attempt: number; pass: boolean; reasons: string[] }) =>
    input.writer.appendGuardVerdict({
      sessionId: input.sessionId,
      turnId: input.tutorTurnId,
      checker: row.checker,
      llmCallId: row.llmCallId,
      tutorLlmCallId: row.tutorLlmCallId,
      attempt: row.attempt,
      verdict: row.pass ? 'pass' : 'block',
      reasons: row.reasons,
    });

  for (let attempt = 1; attempt <= MAX_TUTOR_ATTEMPTS; attempt++) {
    let output: TutorOutput;
    let tutorLlmCallId: string;
    try {
      const messages = tutorConversationMessages(input.history, blockedDraft);
      const result = await callLlm({
        purpose: 'tutor',
        studentId: input.studentId,
        sessionId: input.sessionId,
        turnId: input.tutorTurnId,
        promptVersion: tutorPromptVersion(input.prompt.plan),
        system,
        messages,
        responseSchema: tutorOutputSchema,
        mode: input.evalMode,
        recorder: input.writer.recorder,
      });
      output = result.parsed!;
      tutorLlmCallId = result.llmCallId;
    } catch (err) {
      if (err instanceof LlmOutputInvalidError) {
        blocked.push('OUTPUT_INVALID');
        break;
      }
      throw err;
    }

    // Thử bản chính rồi bản ngắn dự phòng (cùng một lần gọi model): qua kiểm tra cứng thì gửi Guard; Guard
    // chặn bản chính thì thử bản ngắn trước khi gọi lại Tutor (một lần Guard ~1,4 giây, gọi lại ~3,6 giây).
    let lastFailure: { message: string; feedback: string } | null = null;
    for (const candidate of draftCandidates(output, input.hardChecks.maxSentences)) {
      const hard = runHardChecks(candidate, input.hardChecks);
      await verdict({ checker: 'code', llmCallId: null, tutorLlmCallId, attempt, pass: hard.pass, reasons: hard.reasons });
      if (!hard.pass) {
        blocked.push(...hard.reasons);
        lastFailure ??= { message: candidate, feedback: `${hard.reasons.join(', ')} (${hard.details.join('; ')})` };
        continue;
      }
      const guard = await runGuard({
        ...input.guard,
        studentId: input.studentId,
        sessionId: input.sessionId,
        turnId: input.tutorTurnId,
        message: candidate,
        recorder: input.writer.recorder,
        evalMode: input.evalMode,
      });
      await verdict({ checker: 'llm', llmCallId: guard.llmCallId, tutorLlmCallId, attempt, pass: guard.verdict === 'pass', reasons: guard.reasons });
      if (guard.reasons.includes('SAFETY')) guardSafety = true;
      if (guard.verdict === 'pass') {
        return { message: candidate, source: 'tutor', output: { ...output, message: candidate }, tutorLlmCallId, blockedReasons: blocked, guardSafety, attempts: attempt };
      }
      blocked.push(...guard.reasons);
      // Lý do Guard cụ thể hơn lý do độ dài: ưu tiên làm phản hồi cho lần viết sau.
      lastFailure = { message: candidate, feedback: `${guard.reasons.join(', ')}${guard.explanation ? ` — ${guard.explanation}` : ''}` };
      // An toàn: đã có dấu hiệu cần người lớn thì không thử bản khác.
      if (guardSafety) break;
    }
    blockedDraft = lastFailure;
  }

  // Câu dự phòng của bước hiện tại, cũng qua kiểm tra cứng.
  const fallback = planFallbackQuestion(input.prompt.plan, input.prompt.currentStepId, input.prompt.state);
  if (fallback) {
    const hard = runHardChecks(fallback, input.hardChecks);
    await verdict({ checker: 'code', llmCallId: null, tutorLlmCallId: null, attempt: MAX_TUTOR_ATTEMPTS + 1, pass: hard.pass, reasons: hard.reasons });
    if (hard.pass) {
      return { message: fallback, source: 'fallback', output: null, tutorLlmCallId: null, blockedReasons: blocked, guardSafety, attempts: MAX_TUTOR_ATTEMPTS };
    }
  }
  return { message: GENERIC_FALLBACK, source: 'generic', output: null, tutorLlmCallId: null, blockedReasons: blocked, guardSafety, attempts: MAX_TUTOR_ATTEMPTS };
}
