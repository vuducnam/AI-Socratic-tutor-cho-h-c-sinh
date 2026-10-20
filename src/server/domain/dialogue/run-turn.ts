import 'server-only';
import { randomUUID } from 'node:crypto';
import { findDotDecimals, toCanonical } from '@/lib/vi-math-normalizer';
import type { Actor } from '@/server/dal/actor';
import { createFlag } from '@/server/dal/flags-dal';
import { getTurn, withTurnTransaction, type TurnWriter } from '@/server/dal/turns-dal';
import { enqueueParentNotification } from '@/server/jobs/enqueue-parent-notification';
import type { ChatMessage } from '@/server/llm/llm-types';
import { generateHook, generateTransferQuestion } from '@/server/domain/life-context/special-turns';
import { generateSituationalProblem, type SituationalVisual } from '@/server/domain/life-context/generate-situational-problem';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { DONE_MESSAGE, PAUSE_MESSAGE, currentStep } from './fallback-question';
import { generateTutorMessage, type GeneratedMessage } from './generate-tutor-message';
import { numbersIn, runHardChecks } from './hard-checks';
import { runGuard } from './guard';
import { detectFrustration, detectGuessing, noProgressStreak } from './signals';
import { nextState, type DialoguePosition, type DialogueState } from './state-machine';
import {
  answerMatchesFinal,
  detectAdultNeeded,
  detectBeyondScopeCuriosity,
  isSkip,
  looksLikeExplanation,
  stepsCompletedBy,
} from './student-message-analysis';
import type { TurnHints } from './tutor-prompt';
import { loadTurnContext, type TurnContext, type TutorTurnSignals } from './turn-context';
import { getIdempotentResult, saveIdempotentResult, withSessionLock } from './turn-lock';

// Một lượt hội thoại (SPEC §6 bước 3–7). Code quyết định trạng thái (quy tắc cứng 7); mọi tin nhắn gửi
// con đi qua kiểm tra cứng + Guard (quy tắc cứng 1); turns + llm_calls + guard_verdicts ghi chung một
// transaction. Không có learner model ở Giai đoạn 0 (bước 8 thuộc Giai đoạn 1).

export class NoActiveProblemError extends Error {
  constructor() {
    super('Phiên chưa có đề bài đã sẵn sàng');
    this.name = 'NoActiveProblemError';
  }
}

export class ProblemFinishedError extends Error {
  constructor() {
    super('Bài này đã xong, bạn gửi bài mới nhé');
    this.name = 'ProblemFinishedError';
  }
}

export interface StudentTurnInput {
  studentId: string;
  sessionId: string;
  text: string;
  idempotencyKey: string;
  hintRequested?: boolean;
  responseTimeMs?: number;
  inputModality?: 'text' | 'voice';
  rawStt?: string | null;
  evalMode?: 'live' | 'eval';
}

export interface TurnResult {
  studentTurnId: string | null;
  tutorTurnId: string;
  message: string;
  /** Tin nhắn của Cú hiện TRƯỚC `message` trong cùng lượt (câu mở chuyện đời, đề bài tương tự). */
  before?: { turnId: string; content: string; kind: 'hook' | 'parallel_problem' }[];
  /** Hình minh hoạ đi kèm đề tình huống (bài tương tự ở PARALLEL). */
  visual?: SituationalVisual | null;
  state: DialogueState;
  scaffoldLevel: number;
  done: boolean;
  paused: boolean;
  source: GeneratedMessage['source'] | 'fixed';
}

const TERMINAL: DialogueState[] = ['DONE', 'PAUSE'];

function hardCheckContext(ctx: TurnContext, state: DialogueState) {
  const plan = ctx.plan;
  return {
    maxSentences: ctx.preset.max_sentences,
    maxWords: ctx.preset.max_words_per_turn,
    requiredQuestions: TERMINAL.includes(state) ? 0 : Math.min(1, ctx.preset.max_questions_per_turn),
    maxQuestions: ctx.preset.max_questions_per_turn,
    finalAnswer: plan
      ? {
          kind: plan.final_answer.kind,
          canonical: plan.final_answer.canonical,
          expression: plan.sympy_check.expression,
          choiceLabel: plan.final_answer.choice_label,
        }
      : null,
    problemText: ctx.active?.problem.confirmed_text ?? '',
    givenNumbers: plan?.given_numbers ?? [],
    forbiddenTerms: ctx.scope.forbiddenTerms,
  };
}

async function produceTutorMessage(
  ctx: TurnContext,
  writer: TurnWriter,
  args: { tutorTurnId: string; position: DialoguePosition; history: ChatMessage[]; studentMessage: string; completedSteps: string[]; hints?: TurnHints; evalMode?: 'live' | 'eval' },
) {
  const { state, scaffoldLevel } = args.position;
  const stepId = currentStep(ctx.plan, args.completedSteps);
  return generateTutorMessage({
    studentId: ctx.student.id,
    sessionId: ctx.session.id,
    tutorTurnId: args.tutorTurnId,
    history: args.history,
    writer,
    evalMode: args.evalMode,
    hardChecks: hardCheckContext(ctx, state),
    prompt: {
      student: ctx.student,
      preset: ctx.preset,
      scope: ctx.scope,
      mode: ctx.session.mode as 'solve' | 'argue',
      state,
      scaffoldLevel,
      problemText: ctx.active?.problem.confirmed_text ?? '',
      plan: ctx.plan,
      misconceptions: ctx.misconceptions,
      completedSteps: args.completedSteps,
      currentStepId: stepId,
      skillSource: ctx.skillSource,
      // Giai đoạn 0 chưa có learner model (Giai đoạn 1): không bịa nhận định.
      learnerSummary: 'Chưa đủ dữ liệu.',
      hints: args.hints,
    },
    guard: guardInputFor(ctx, args.studentMessage, args.completedSteps, state),
  });
}

function guardInputFor(ctx: TurnContext, studentMessage: string, completedSteps: string[], state: DialogueState) {
  return {
    studentMessage,
    grade: ctx.student.grade,
    preset: ctx.preset,
    scope: ctx.scope,
    plan: ctx.plan,
    problemText: ctx.active?.problem.confirmed_text ?? '',
    origin: ctx.active?.problem.origin ?? 'homework',
    completedSteps,
    skillSource: ctx.skillSource,
    mode: ctx.session.mode as 'solve' | 'argue',
    state,
  };
}

async function raiseSafetyFlag(actor: Actor, studentId: string, sessionId: string, turnIds: string[], detail: Record<string, unknown>) {
  const flagId = await createFlag(actor, { studentId, sessionId, type: 'safety_pause', severity: 'high', detail, evidenceTurnIds: turnIds });
  await enqueueParentNotification(flagId);
}

/**
 * Mở bài (SPEC §5b.1 lớp 1, §7): lượt `hook` (một câu chuyện đời, không phải câu hỏi) rồi lượt ELICIT
 * mời con bắt đầu. Bài về nhà vẫn giữ nguyên đề, chỉ thêm câu mở.
 */
export async function openProblemTurn(actor: Actor, input: { studentId: string; sessionId: string; evalMode?: 'live' | 'eval' }): Promise<TurnResult> {
  return withSessionLock(input.sessionId, async () => {
    const ctx = await loadTurnContext(actor, input);
    if (!ctx.active) throw new NoActiveProblemError();
    const hookTurnId = randomUUID();
    const tutorTurnId = randomUUID();
    const position = ctx.position;
    const emptySignals = { completed_steps: [], made_progress: true, student_answers: [], response_times_ms: [] };
    const { hook, generated } = await withTurnTransaction(actor, input, async (writer) => {
      const hook = await generateHook({
        ctx,
        writer,
        turnId: hookTurnId,
        hardChecks: hardCheckContext(ctx, position.state),
        guard: guardInputFor(ctx, '', ctx.completedSteps, position.state),
        evalMode: input.evalMode,
      });
      await writer.appendTurn({
        id: hookTurnId,
        sessionId: input.sessionId,
        role: 'tutor',
        content: hook.message,
        turnKind: 'hook',
        stateBefore: position.state,
        stateAfter: position.state,
        scaffoldLevel: position.scaffoldLevel,
        problemId: ctx.active!.problem.id,
        signals: { ...emptySignals, source: hook.source },
      });
      const history: ChatMessage[] = [{ role: 'assistant', content: hook.message }];
      const g = await produceTutorMessage(ctx, writer, { tutorTurnId, position, history, studentMessage: '', completedSteps: [], evalMode: input.evalMode });
      await writer.appendTurn({
        id: tutorTurnId,
        sessionId: input.sessionId,
        role: g.source === 'generic' ? 'system' : 'tutor',
        content: g.message,
        stateBefore: position.state,
        stateAfter: position.state,
        scaffoldLevel: position.scaffoldLevel,
        questionType: g.output?.question_type ?? null,
        stepAddressed: g.output?.step_addressed ?? null,
        studentStateGuess: g.output?.student_state_guess ?? null,
        problemId: ctx.active!.problem.id,
        signals: { ...emptySignals, source: g.source, blocked_reasons: g.blockedReasons } satisfies TutorTurnSignals,
      });
      return { hook, generated: g };
    });
    if (generated.source === 'generic') {
      await createFlag(actor, { studentId: input.studentId, sessionId: input.sessionId, type: 'tutor_generic_fallback', severity: 'warning', evidenceTurnIds: [tutorTurnId] });
    }
    return {
      studentTurnId: null,
      tutorTurnId,
      message: generated.message,
      before: [{ turnId: hookTurnId, content: hook.message, kind: 'hook' }],
      state: position.state,
      scaffoldLevel: position.scaffoldLevel,
      done: false,
      paused: false,
      source: generated.source,
    };
  });
}

export async function runStudentTurn(actor: Actor, input: StudentTurnInput): Promise<TurnResult> {
  const cached = await getIdempotentResult<Omit<TurnResult, 'message'>>(input.sessionId, input.idempotencyKey);
  if (cached) {
    const turn = await getTurn(actor, { studentId: input.studentId, turnId: cached.tutorTurnId });
    return { ...cached, message: turn.content };
  }

  return withSessionLock(input.sessionId, async () => {
    const ctx = await loadTurnContext(actor, input);
    if (!ctx.active || !ctx.plan) throw new NoActiveProblemError();
    if (TERMINAL.includes(ctx.position.state)) throw new ProblemFinishedError();
    const plan = ctx.plan;
    const text = input.text.trim();
    const studentTurnId = randomUUID();
    const tutorTurnId = randomUUID();
    const state = ctx.position.state;

    // ── Phân tích bằng code ──
    const newSteps = stepsCompletedBy(text, plan, ctx.completedSteps);
    const completedSteps = [...ctx.completedSteps, ...newSteps];
    const matchesFinal = ctx.session.mode === 'solve' && answerMatchesFinal(text, plan);
    const explained = (state === 'CONSOLIDATE' || ctx.session.mode === 'argue') && looksLikeExplanation(text);
    const madeProgress = newSteps.length > 0 || matchesFinal || explained;
    const answer = numbersIn(text).join(';') || null;
    const adultNeeded = detectAdultNeeded(text);
    const curiosity = detectBeyondScopeCuriosity(text, ctx.scope.forbiddenTerms);

    const frustrated = detectFrustration(text, ctx.recentStudentTexts).frustrated;
    const guessing = detectGuessing([...ctx.answerAttempts, { answer, responseTimeMs: input.responseTimeMs ?? Number.NaN }]);
    const dotDecimal = findDotDecimals(text).length > 0;
    const hints: TurnHints = { guessing, dotDecimal };
    const next = nextState({
      current: ctx.position,
      mode: ctx.session.mode as 'solve' | 'argue',
      signals: {
        noProgressStreak: noProgressStreak([...ctx.progressMarks, { madeProgress }]),
        frustrated,
        guessing,
      },
      events: {
        studentRequestedHint: !!input.hintRequested,
        stepCompleted: newSteps.length > 0,
        // Ở PARALLEL, đáp án đúng là của bài tương tự → quay về bài gốc, không phải CONSOLIDATE.
        answerMatchesFinal: state === 'PARALLEL' ? false : matchesFinal,
        argueReasonGiven: ctx.session.mode === 'argue' && explained,
        explainedMethodOrMistake: state === 'CONSOLIDATE' && explained,
        parallelSolved: state === 'PARALLEL' && matchesFinal,
        transferAnswered: state === 'TRANSFER' && !isSkip(text) && text.length > 0,
        transferSkipped: state === 'TRANSFER' && isSkip(text),
        directTeachTurnsDone: 0,
        microLessonFinished: false,
      },
      safety: { guardSafety: false, adultNeeded: adultNeeded.length > 0 },
      escalationThreshold: ctx.preset.escalation_threshold,
      prerequisiteMastery: {},
      studentStateGuess: null,
    });

    let position: DialoguePosition = { state: next.state, scaffoldLevel: next.scaffoldLevel };
    const history: ChatMessage[] = [...ctx.history, { role: 'user', content: text }];

    // ── PARALLEL: bài tương tự luôn là bài tình huống từ life_contexts đã duyệt (quy tắc cứng 13) ──
    let parallel: { problemId: string; problemText: string; visual: SituationalVisual | null } | null = null;
    if (position.state === 'PARALLEL' && state !== 'PARALLEL') {
      const generated = await generateSituationalProblem(actor, {
        studentId: input.studentId,
        sessionId: input.sessionId,
        student: ctx.student,
        scope: ctx.scope,
        catalog: await loadScopeCatalog(ctx.scope.subject, ctx.student.grade),
        targetSkillIds: plan.skill_ids,
        parallelOf: ctx.active.problem.id,
        evalMode: input.evalMode,
      });
      if (generated.ok) parallel = { problemId: generated.problemId, problemText: generated.problemText, visual: generated.visual };
      // Cạn thư viện / sinh không được → ở lại SCAFFOLD(3), không bao giờ sinh bài trơn.
      else position = { state: 'SCAFFOLD', scaffoldLevel: 3 };
    }
    // Xong bài tương tự → quay về bài gốc với lịch sử của bài gốc.
    const replyCtx =
      state === 'PARALLEL' && position.state !== 'PARALLEL' && ctx.parallelOf
        ? await loadTurnContext(actor, { ...input, forceProblemId: ctx.parallelOf })
        : ctx;
    const replyHistory: ChatMessage[] =
      replyCtx === ctx
        ? history
        : [...replyCtx.history, { role: 'user', content: `[Hệ thống] Con vừa giải xong bài tương tự (con trả lời: ${text}). Quay lại bài gốc.` }];
    const replyProblemId = replyCtx.active!.problem.id;
    const parallelCtx = parallel ? await loadTurnContext(actor, { ...input, forceProblemId: parallel.problemId }) : null;

    const outcome = await withTurnTransaction(actor, input, async (writer) => {
      await writer.appendTurn({
        id: studentTurnId,
        sessionId: input.sessionId,
        role: 'student',
        content: text,
        inputModality: input.inputModality ?? 'text',
        rawStt: input.rawStt ?? null,
        normalizedContent: toCanonical(text),
        stateBefore: state,
        stateAfter: position.state,
        turnKind: state === 'TRANSFER' ? 'transfer_answer' : 'normal',
        problemId: ctx.active!.problem.id,
      });

      let message: string;
      let generated: GeneratedMessage | null = null;
      let turnKind: 'normal' | 'transfer_question' = 'normal';
      if (position.state === 'PAUSE') message = PAUSE_MESSAGE;
      else if (position.state === 'DONE') message = DONE_MESSAGE;
      else if (parallel && parallelCtx) {
        // Đề bài tương tự cũng qua kiểm tra cứng (≤ 3 câu, đúng 1 câu hỏi) và Guard (rule CONTEXT).
        const hard = runHardChecks(parallel.problemText, {
          ...hardCheckContext(parallelCtx, 'PARALLEL'),
          maxSentences: ctx.preset.max_sentences_situational,
          maxWords: ctx.preset.max_words_per_turn * 2,
          // Đề bài tất nhiên chứa số liệu của chính nó; kiểm lộ đáp án của bài tương tự vẫn chạy.
        });
        const guard = hard.pass
          ? await runGuard({
              ...guardInputFor(parallelCtx, text, [], 'PARALLEL'),
              studentId: input.studentId,
              sessionId: input.sessionId,
              turnId: tutorTurnId,
              message: parallel.problemText,
              recorder: writer.recorder,
              evalMode: input.evalMode,
            })
          : null;
        await writer.appendGuardVerdict({
          sessionId: input.sessionId,
          turnId: tutorTurnId,
          checker: 'code',
          llmCallId: null,
          tutorLlmCallId: null,
          attempt: 1,
          verdict: hard.pass ? 'pass' : 'block',
          reasons: hard.reasons,
        });
        if (guard) {
          await writer.appendGuardVerdict({
            sessionId: input.sessionId,
            turnId: tutorTurnId,
            checker: 'llm',
            llmCallId: guard.llmCallId,
            tutorLlmCallId: null,
            attempt: 1,
            verdict: guard.verdict,
            reasons: guard.reasons,
          });
        }
        if (guard?.verdict === 'pass') message = parallel.problemText;
        else {
          parallel = null;
          position = { state: 'SCAFFOLD', scaffoldLevel: 3 };
          generated = await produceTutorMessage(ctx, writer, { tutorTurnId, position, history, studentMessage: text, completedSteps, hints, evalMode: input.evalMode });
          message = generated.message;
        }
      } else if (position.state === 'TRANSFER') {
        const t = await generateTransferQuestion({
          ctx,
          writer,
          turnId: tutorTurnId,
          hardChecks: hardCheckContext(ctx, 'TRANSFER'),
          guard: guardInputFor(ctx, text, completedSteps, 'TRANSFER'),
          evalMode: input.evalMode,
        });
        message = t.message;
        turnKind = 'transfer_question';
      } else {
        generated = await produceTutorMessage(replyCtx, writer, {
          tutorTurnId,
          position,
          history: replyHistory,
          studentMessage: text,
          completedSteps: replyCtx === ctx ? completedSteps : replyCtx.completedSteps,
          hints,
          evalMode: input.evalMode,
        });
        message = generated.message;
        // Guard thấy con có dấu hiệu cần người lớn mà tin nhắn bỏ qua → dừng bài (* → PAUSE).
        if (generated.guardSafety) {
          position = { state: 'PAUSE', scaffoldLevel: position.scaffoldLevel };
          message = PAUSE_MESSAGE;
        }
      }

      const signals: TutorTurnSignals = {
        completed_steps: parallel ? [] : replyCtx === ctx ? completedSteps : replyCtx.completedSteps,
        made_progress: madeProgress,
        student_answers: [answer],
        response_times_ms: input.responseTimeMs !== undefined ? [input.responseTimeMs] : [],
        reason: next.reason,
        guessing,
        frustrated,
        dot_decimal: dotDecimal,
        blocked_reasons: generated?.blockedReasons ?? [],
        source: generated?.source ?? 'fixed',
      };
      await writer.appendTurn({
        id: tutorTurnId,
        sessionId: input.sessionId,
        role: generated?.source === 'generic' ? 'system' : 'tutor',
        content: message,
        stateBefore: state,
        stateAfter: position.state,
        scaffoldLevel: position.scaffoldLevel,
        questionType: generated?.output?.question_type ?? null,
        stepAddressed: generated?.output?.step_addressed ?? null,
        studentStateGuess: generated?.output?.student_state_guess ?? null,
        turnKind,
        problemId: parallel?.problemId ?? replyProblemId,
        signals: signals as unknown as Record<string, unknown>,
      });
      return { message, generated, parallel };
    });

    // ── Cờ cho phụ huynh (sau khi lượt đã ghi) ──
    if (position.state === 'PAUSE') {
      await raiseSafetyFlag(actor, input.studentId, input.sessionId, [studentTurnId, tutorTurnId], {
        code_signals: adultNeeded,
        guard_safety: outcome.generated?.guardSafety ?? false,
      });
    }
    if (curiosity.length) {
      await createFlag(actor, {
        studentId: input.studentId,
        sessionId: input.sessionId,
        type: 'beyond_scope_curiosity',
        severity: 'info',
        detail: { terms: curiosity },
        evidenceTurnIds: [studentTurnId],
      });
    }
    if (outcome.generated?.source === 'generic') {
      await createFlag(actor, { studentId: input.studentId, sessionId: input.sessionId, type: 'tutor_generic_fallback', severity: 'warning', evidenceTurnIds: [tutorTurnId] });
    }

    const result: TurnResult = {
      studentTurnId,
      tutorTurnId,
      message: outcome.message,
      state: position.state,
      scaffoldLevel: position.scaffoldLevel,
      done: position.state === 'DONE',
      paused: position.state === 'PAUSE',
      source: outcome.generated?.source ?? 'fixed',
      visual: outcome.parallel?.visual ?? null,
    };
    const { message: _omit, ...stored } = result;
    await saveIdempotentResult(input.sessionId, input.idempotencyKey, stored);
    return result;
  });
}
