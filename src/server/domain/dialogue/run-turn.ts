import 'server-only';
import { randomUUID } from 'node:crypto';
import { toCanonical } from '@/lib/vi-math-normalizer';
import type { Actor } from '@/server/dal/actor';
import { createFlag } from '@/server/dal/flags-dal';
import { getTurn, withTurnTransaction, type TurnWriter } from '@/server/dal/turns-dal';
import { enqueueParentNotification } from '@/server/jobs/enqueue-parent-notification';
import type { ChatMessage } from '@/server/llm/llm-types';
import { DONE_MESSAGE, PAUSE_MESSAGE, currentStep } from './fallback-question';
import { generateTutorMessage, type GeneratedMessage } from './generate-tutor-message';
import { numbersIn } from './hard-checks';
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
    super('Bài này đã xong, con gửi bài mới nhé');
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
  args: { tutorTurnId: string; position: DialoguePosition; history: ChatMessage[]; studentMessage: string; completedSteps: string[]; evalMode?: 'live' | 'eval' },
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
    },
    guard: {
      studentMessage: args.studentMessage,
      grade: ctx.student.grade,
      preset: ctx.preset,
      scope: ctx.scope,
      plan: ctx.plan,
      problemText: ctx.active?.problem.confirmed_text ?? '',
      origin: ctx.active?.problem.origin ?? 'homework',
      completedSteps: args.completedSteps,
      skillSource: ctx.skillSource,
      mode: ctx.session.mode as 'solve' | 'argue',
      state,
    },
  });
}

async function raiseSafetyFlag(actor: Actor, studentId: string, sessionId: string, turnIds: string[], detail: Record<string, unknown>) {
  const flagId = await createFlag(actor, { studentId, sessionId, type: 'safety_pause', severity: 'high', detail, evidenceTurnIds: turnIds });
  await enqueueParentNotification(flagId);
}

/** Lượt mở bài (ELICIT): Cú nói trước, chưa có lượt của con. Phase 13 thay bằng câu mở chuyện đời. */
export async function openProblemTurn(actor: Actor, input: { studentId: string; sessionId: string; evalMode?: 'live' | 'eval' }): Promise<TurnResult> {
  return withSessionLock(input.sessionId, async () => {
    const ctx = await loadTurnContext(actor, input);
    if (!ctx.active) throw new NoActiveProblemError();
    const tutorTurnId = randomUUID();
    const position = ctx.position;
    const generated = await withTurnTransaction(actor, input, async (writer) => {
      const g = await produceTutorMessage(ctx, writer, { tutorTurnId, position, history: [], studentMessage: '', completedSteps: [], evalMode: input.evalMode });
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
        signals: { completed_steps: [], made_progress: true, student_answers: [], response_times_ms: [], source: g.source, blocked_reasons: g.blockedReasons } satisfies TutorTurnSignals,
      });
      return g;
    });
    if (generated.source === 'generic') {
      await createFlag(actor, { studentId: input.studentId, sessionId: input.sessionId, type: 'tutor_generic_fallback', severity: 'warning', evidenceTurnIds: [tutorTurnId] });
    }
    return { studentTurnId: null, tutorTurnId, message: generated.message, state: position.state, scaffoldLevel: position.scaffoldLevel, done: false, paused: false, source: generated.source };
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

    const next = nextState({
      current: ctx.position,
      mode: ctx.session.mode as 'solve' | 'argue',
      signals: {
        noProgressStreak: noProgressStreak([...ctx.progressMarks, { madeProgress }]),
        frustrated: detectFrustration(text, ctx.recentStudentTexts).frustrated,
        guessing: detectGuessing([...ctx.answerAttempts, { answer, responseTimeMs: input.responseTimeMs ?? Number.NaN }]),
      },
      events: {
        studentRequestedHint: !!input.hintRequested,
        stepCompleted: newSteps.length > 0,
        answerMatchesFinal: matchesFinal,
        argueReasonGiven: ctx.session.mode === 'argue' && explained,
        explainedMethodOrMistake: state === 'CONSOLIDATE' && explained,
        parallelSolved: false,
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
        stateAfter: next.state,
        turnKind: state === 'TRANSFER' ? 'transfer_answer' : 'normal',
        problemId: ctx.active!.problem.id,
      });

      let message: string;
      let generated: GeneratedMessage | null = null;
      if (position.state === 'PAUSE') message = PAUSE_MESSAGE;
      else if (position.state === 'DONE') message = DONE_MESSAGE;
      else {
        generated = await produceTutorMessage(ctx, writer, { tutorTurnId, position, history, studentMessage: text, completedSteps, evalMode: input.evalMode });
        message = generated.message;
        // Guard thấy con có dấu hiệu cần người lớn mà tin nhắn bỏ qua → dừng bài (* → PAUSE).
        if (generated.guardSafety) {
          position = { state: 'PAUSE', scaffoldLevel: position.scaffoldLevel };
          message = PAUSE_MESSAGE;
        }
      }

      const signals: TutorTurnSignals = {
        completed_steps: completedSteps,
        made_progress: madeProgress,
        student_answers: [answer],
        response_times_ms: input.responseTimeMs !== undefined ? [input.responseTimeMs] : [],
        reason: next.reason,
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
        problemId: ctx.active!.problem.id,
        signals: signals as unknown as Record<string, unknown>,
      });
      return { message, generated };
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
    };
    const { message: _omit, ...stored } = result;
    await saveIdempotentResult(input.sessionId, input.idempotencyKey, stored);
    return result;
  });
}
