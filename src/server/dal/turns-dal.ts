import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { writeLlmCall, type LlmCallRecorder, type LlmCallRow } from './llm-calls-dal';

// turns [AO], guard_verdicts [AO]: chỉ append. Một lượt hội thoại ghi turns, llm_calls (turn_id
// DEFERRABLE) và guard_verdicts trong CÙNG một transaction (lệch SPEC §3 có chủ đích, phase 02).
// Transaction rollback (lỗi giữa lượt) → các dòng llm_calls vẫn được ghi lại bên ngoài, turn_id = null,
// để phụ huynh không mất dấu lượt gọi model nào (quy tắc cứng 2).

export interface TurnRow {
  id: string;
  sessionId: string;
  role: 'student' | 'tutor' | 'system';
  content: string;
  inputModality?: string | null;
  rawStt?: string | null;
  normalizedContent?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  scaffoldLevel?: number | null;
  questionType?: string | null;
  turnKind?: 'normal' | 'hook' | 'transfer_question' | 'transfer_answer';
  stepAddressed?: string | null;
  studentStateGuess?: string | null;
  signals?: Record<string, unknown> | null;
  problemId?: string | null;
}

export interface GuardVerdictRow {
  sessionId: string;
  turnId: string | null;
  checker: 'code' | 'llm';
  llmCallId: string | null;
  tutorLlmCallId: string | null;
  attempt: number;
  verdict: 'pass' | 'block';
  reasons: string[];
}

export interface TurnWriter {
  recorder: LlmCallRecorder;
  appendTurn(row: TurnRow): Promise<void>;
  appendGuardVerdict(row: GuardVerdictRow): Promise<void>;
}

async function assertSessionOfStudent(sessionId: string, studentId: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { student_id: true } });
  if (!s || s.student_id !== studentId) throw new AuthorizationError('Không có phiên này');
}

export async function withTurnTransaction<T>(
  actor: Actor,
  input: { studentId: string; sessionId: string },
  fn: (writer: TurnWriter) => Promise<T>,
): Promise<T> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'turns', log: actor.type !== 'student' });
  await assertSessionOfStudent(input.sessionId, input.studentId);
  const recorded: LlmCallRow[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        let seq = (await tx.turn.aggregate({ where: { session_id: input.sessionId }, _max: { seq: true } }))._max.seq ?? 0;
        const writer: TurnWriter = {
          recorder: {
            append: async (row) => {
              recorded.push(row);
              return writeLlmCall(tx, row);
            },
          },
          appendTurn: async (row) => {
            seq += 1;
            await tx.turn.create({
              data: {
                id: row.id,
                session_id: row.sessionId,
                seq,
                role: row.role,
                content: row.content,
                input_modality: row.inputModality ?? null,
                raw_stt: row.rawStt ?? null,
                normalized_content: row.normalizedContent ?? null,
                state_before: row.stateBefore ?? null,
                state_after: row.stateAfter ?? null,
                scaffold_level: row.scaffoldLevel ?? null,
                question_type: row.questionType ?? null,
                turn_kind: row.turnKind ?? 'normal',
                step_addressed: row.stepAddressed ?? null,
                student_state_guess: row.studentStateGuess ?? null,
                signals: (row.signals ?? undefined) as object | undefined,
                problem_id: row.problemId ?? null,
              },
            });
          },
          appendGuardVerdict: async (row) => {
            await tx.guardVerdict.create({
              data: {
                session_id: row.sessionId,
                turn_id: row.turnId,
                checker: row.checker,
                llm_call_id: row.llmCallId,
                tutor_llm_call_id: row.tutorLlmCallId,
                attempt: row.attempt,
                verdict: row.verdict,
                reasons: row.reasons,
              },
            });
          },
        };
        const result = await fn(writer);
        await tx.session.update({ where: { id: input.sessionId }, data: { last_activity_at: new Date() } });
        return result;
      },
      { timeout: 180_000, maxWait: 10_000 },
    );
  } catch (err) {
    for (const row of recorded) {
      await writeLlmCall(prisma, { ...row, id: undefined, turnId: null, error: row.error ?? 'lượt hội thoại bị huỷ (rollback)' }).catch(() => undefined);
    }
    throw err;
  }
}

export async function listSessionTurns(actor: Actor, input: { studentId: string; sessionId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'turns', log: actor.type !== 'student' });
  await assertSessionOfStudent(input.sessionId, input.studentId);
  return prisma.turn.findMany({ where: { session_id: input.sessionId }, orderBy: { seq: 'asc' } });
}

/** Lượt chat sau mã idempotency: để lấy lại kết quả khi client gửi lại. */
export async function getTurn(actor: Actor, input: { studentId: string; turnId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'turns', log: actor.type !== 'student' });
  const t = await prisma.turn.findUnique({ where: { id: input.turnId }, include: { session: { select: { student_id: true } } } });
  if (!t || t.session.student_id !== input.studentId) throw new AuthorizationError('Không có lượt này');
  return t;
}

const FAKE = '00000000-0000-0000-0000-000000000001';
export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  withTurnTransaction: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => withTurnTransaction(a, { studentId: c.studentId, sessionId: c.sessionId }, async () => undefined),
  },
  listSessionTurns: { kind: 'student-scoped', call: (a, c) => listSessionTurns(a, { studentId: c.studentId, sessionId: c.sessionId }) },
  getTurn: { kind: 'student-scoped', linkedParentAllowed: false, call: (a, c) => getTurn(a, { studentId: c.studentId, turnId: FAKE }) },
};
