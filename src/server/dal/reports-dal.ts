import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertSystem } from './role-guards';

// Báo cáo (reports). Số liệu do code tính; LLM chỉ viết diễn giải kèm evidence (quy tắc cứng 4).

/** Worker: mọi dữ liệu của một phiên cần cho báo cáo phiên. */
export async function loadSessionForReport(actor: Actor, input: { studentId: string; sessionId: string }) {
  assertSystem(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'session_report_inputs' });
  const session = await prisma.session.findFirstOrThrow({ where: { id: input.sessionId, student_id: input.studentId } });
  const [turns, verdicts, feedback, problems, flags] = await Promise.all([
    prisma.turn.findMany({ where: { session_id: input.sessionId }, orderBy: { seq: 'asc' } }),
    prisma.guardVerdict.findMany({ where: { session_id: input.sessionId } }),
    prisma.sessionFeedback.findUnique({ where: { session_id: input.sessionId } }),
    prisma.problem.findMany({ where: { session_id: input.sessionId }, orderBy: { created_at: 'asc' } }),
    prisma.flag.findMany({ where: { session_id: input.sessionId } }),
  ]);
  const skillIds = [...new Set(problems.flatMap((p) => p.skill_ids))];
  const skills = await prisma.skill.findMany({ where: { skill_id: { in: skillIds } }, select: { skill_id: true, name: true, source: true } });
  return { session, turns, verdicts, feedback, problems, flags, skills };
}

/** Kiểm evidence bằng code: mọi turn/session phải tồn tại và thuộc đúng học sinh. */
export async function validEvidenceIds(actor: Actor, input: { studentId: string; turnIds: string[]; sessionIds: string[] }) {
  assertSystem(actor);
  // id do model viết: không phải uuid thì chắc chắn không hợp lệ (và không được đưa vào truy vấn uuid).
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  input = { ...input, turnIds: input.turnIds.filter((id) => uuid.test(id)), sessionIds: input.sessionIds.filter((id) => uuid.test(id)) };
  const [turns, sessions] = await Promise.all([
    prisma.turn.findMany({ where: { id: { in: input.turnIds }, session: { student_id: input.studentId } }, select: { id: true } }),
    prisma.session.findMany({ where: { id: { in: input.sessionIds }, student_id: input.studentId }, select: { id: true } }),
  ]);
  return { turnIds: new Set(turns.map((t) => t.id)), sessionIds: new Set(sessions.map((s) => s.id)) };
}

export async function appendSessionReport(
  actor: Actor,
  input: { studentId: string; sessionId: string; periodStart: Date; periodEnd: Date; metrics: unknown; narrative: unknown; llmCallId: string | null },
): Promise<string> {
  assertSystem(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'reports' });
  const existing = await prisma.report.findFirst({ where: { session_id: input.sessionId, type: 'session' }, select: { id: true } });
  if (existing) return existing.id;
  const row = await prisma.report.create({
    data: {
      student_id: input.studentId,
      session_id: input.sessionId,
      type: 'session',
      period_start: input.periodStart,
      period_end: input.periodEnd,
      metrics: input.metrics as object,
      narrative: (input.narrative ?? undefined) as object | undefined,
      llm_call_id: input.llmCallId,
    },
    select: { id: true },
  });
  return row.id;
}

export async function getSessionReport(actor: Actor, input: { studentId: string; sessionId: string }) {
  if (actor.type === 'student') throw new AuthorizationError('Báo cáo chỉ dành cho phụ huynh');
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'reports' });
  return prisma.report.findFirst({ where: { student_id: input.studentId, session_id: input.sessionId, type: 'session' } });
}

const FAKE = '00000000-0000-0000-0000-000000000001';
export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  loadSessionForReport: { kind: 'system-only', call: (a, c) => loadSessionForReport(a, { studentId: c.studentId, sessionId: c.sessionId }) },
  validEvidenceIds: { kind: 'system-only', call: (a, c) => validEvidenceIds(a, { studentId: c.studentId, turnIds: [], sessionIds: [] }) },
  appendSessionReport: {
    kind: 'system-only',
    call: (a, c) =>
      appendSessionReport(a, { studentId: c.studentId, sessionId: FAKE, periodStart: new Date(), periodEnd: new Date(), metrics: {}, narrative: null, llmCallId: null }),
  },
  getSessionReport: { kind: 'student-scoped', call: (a, c) => getSessionReport(a, { studentId: c.studentId, sessionId: c.sessionId }) },
};
