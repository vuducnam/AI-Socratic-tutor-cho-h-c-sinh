import 'server-only';
import { z } from 'zod';
import type { TurnWriter } from '@/server/dal/turns-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import { subjectName } from '@/server/domain/curriculum/subject-config';
import { runGuard, type GuardInput } from '@/server/domain/dialogue/guard';
import { runHardChecks, type HardCheckContext } from '@/server/domain/dialogue/hard-checks';
import type { TurnContext } from '@/server/domain/dialogue/turn-context';
import { callLlm, LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';

// Câu mở chuyện đời (hook/v1) và câu hỏi chuyển giao (transfer/v1) — SPEC §5b.1 lớp 1 và 4, quy tắc cứng 13.
// Như mọi tin nhắn gửi con: kiểm tra cứng + Guard; bị chặn 2 lần → câu cố định đã duyệt sẵn.

export const HOOK_PROMPT = 'hook/v5';
// Môn kiến thức (SPEC §5d): chuyện đời thường quanh em, không nói ra ý chính của bài.
export const HOOK_KNOWLEDGE_PROMPT = 'hook_knowledge/v2';
export const TRANSFER_PROMPT = 'transfer/v4';
export const HOOK_FALLBACK = 'Bài hôm nay giúp mình làm được nhiều việc ngoài đời lắm đấy.';
export const TRANSFER_FALLBACK = 'Bạn nghĩ mình sẽ gặp lại cách làm này ở đâu ngoài đời nhỉ?';

interface SpecialTurnInput {
  ctx: TurnContext;
  writer: TurnWriter;
  turnId: string;
  hardChecks: HardCheckContext;
  guard: Omit<GuardInput, 'message' | 'turnId' | 'recorder' | 'studentId' | 'sessionId'>;
  evalMode?: 'live' | 'eval';
}

async function checkedMessage(
  input: SpecialTurnInput,
  spec: { purpose: 'hook' | 'transfer'; promptId: string; system: string; schema: z.ZodType<Record<string, string>>; field: string; fallback: string; hardChecks: HardCheckContext },
): Promise<{ message: string; source: 'llm' | 'fixed' }> {
  let feedback = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text: string;
    let llmCallId: string;
    try {
      const r = await callLlm({
        purpose: spec.purpose,
        studentId: input.ctx.student.id,
        sessionId: input.ctx.session.id,
        turnId: input.turnId,
        promptVersion: spec.promptId,
        system: [{ text: spec.system, cache: true }],
        messages: [{ role: 'user', content: feedback ? `Viết lại, lần trước bị chặn: ${feedback}` : 'Viết.' }],
        responseSchema: spec.schema,
        mode: input.evalMode,
        recorder: input.writer.recorder,
      });
      text = r.parsed![spec.field]!;
      llmCallId = r.llmCallId;
    } catch (err) {
      if (err instanceof LlmOutputInvalidError) break;
      throw err;
    }
    const hard = runHardChecks(text, spec.hardChecks);
    await input.writer.appendGuardVerdict({
      sessionId: input.ctx.session.id,
      turnId: input.turnId,
      checker: 'code',
      llmCallId: null,
      tutorLlmCallId: llmCallId,
      attempt,
      verdict: hard.pass ? 'pass' : 'block',
      reasons: hard.reasons,
    });
    if (!hard.pass) {
      feedback = hard.details.join('; ');
      continue;
    }
    const guard = await runGuard({
      ...input.guard,
      messageKind: spec.purpose === 'hook' ? 'hook' : 'transfer_question',
      studentId: input.ctx.student.id,
      sessionId: input.ctx.session.id,
      turnId: input.turnId,
      message: text,
      recorder: input.writer.recorder,
      evalMode: input.evalMode,
    });
    await input.writer.appendGuardVerdict({
      sessionId: input.ctx.session.id,
      turnId: input.turnId,
      checker: 'llm',
      llmCallId: guard.llmCallId,
      tutorLlmCallId: llmCallId,
      attempt,
      verdict: guard.verdict,
      reasons: guard.reasons,
    });
    if (guard.verdict === 'pass') return { message: text, source: 'llm' };
    feedback = `${guard.reasons.join(', ')} ${guard.explanation}`;
  }
  return { message: spec.fallback, source: 'fixed' };
}

const skillNames = (ctx: TurnContext) => ctx.skillSource;

export async function generateHook(input: SpecialTurnInput) {
  const knowledge = input.ctx.plan?.final_answer.kind === 'key_points';
  const promptId = knowledge ? HOOK_KNOWLEDGE_PROMPT : HOOK_PROMPT;
  const prompt = await loadPrompt(promptId);
  const system = renderPrompt(prompt.content, {
    ...(knowledge ? { subject_name: subjectName(input.ctx.scope.subject) } : {}),
    display_name: input.ctx.student.display_name,
    student_name: input.ctx.student.display_name,
    grade: input.ctx.student.grade,
    skill_names: skillNames(input.ctx),
    interests: input.ctx.student.interests_declared.join(', ') || 'chưa khai',
    problem_text: input.ctx.active?.problem.confirmed_text ?? '',
    curriculum_scope: renderCurriculumScope(input.ctx.scope),
  });
  // Câu mở: một câu, không phải câu hỏi.
  const hardChecks = { ...input.hardChecks, maxSentences: 1, requiredQuestions: 0, maxQuestions: 0 };
  return checkedMessage(input, {
    purpose: 'hook',
    promptId,
    system,
    schema: z.object({ hook: z.string().min(1).max(300) }),
    field: 'hook',
    fallback: HOOK_FALLBACK,
    hardChecks,
  });
}

export async function generateTransferQuestion(input: SpecialTurnInput) {
  const prompt = await loadPrompt(TRANSFER_PROMPT);
  const system = renderPrompt(prompt.content, {
    display_name: input.ctx.student.display_name,
    grade: input.ctx.student.grade,
    skill_names: skillNames(input.ctx),
    interests: input.ctx.student.interests_declared.join(', ') || 'chưa khai',
    student_message: input.guard.studentMessage,
    curriculum_scope: renderCurriculumScope(input.ctx.scope),
  });
  return checkedMessage(input, {
    purpose: 'transfer',
    promptId: TRANSFER_PROMPT,
    system,
    schema: z.object({ question: z.string().min(1).max(300) }),
    field: 'question',
    fallback: TRANSFER_FALLBACK,
    hardChecks: input.hardChecks,
  });
}
