import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Màn hình /parent: tổng quan, danh sách phiên, transcript đầy đủ (SPEC §11.1, quy tắc cứng 2, 14).
// Mỗi hàm kiểm quyền một lần và ghi một dòng access_log cho mỗi lần tải trang (không ghi theo từng dòng).

const RECENT_SESSIONS = 5;

function assertParentOrAdmin(actor: Actor): void {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
}

/** Tổng quan: các con liên kết với tài khoản, phiên gần nhất, số cờ chưa xem. */
export async function getParentOverview(actor: Actor) {
  assertParentOrAdmin(actor);
  const links = await prisma.parentStudent.findMany({
    where: { parent_id: actor.id },
    orderBy: { created_at: 'asc' },
    select: { student: { select: { id: true, display_name: true, grade: true, status: true } } },
  });
  const children = [];
  for (const { student } of links) {
    await assertStudentAccess(actor, student.id, { action: 'read', resource: 'overview' });
    const [recentSessions, unacknowledgedFlags] = await Promise.all([
      prisma.session.findMany({
        where: { student_id: student.id },
        orderBy: { started_at: 'desc' },
        take: RECENT_SESSIONS,
        select: { id: true, subject: true, mode: true, started_at: true, ended_at: true, _count: { select: { turns: true } } },
      }),
      prisma.flag.count({ where: { student_id: student.id, acknowledged_at: null } }),
    ]);
    children.push({ ...student, recentSessions, unacknowledgedFlags });
  }
  return children;
}

/** Danh sách mọi phiên của một học sinh (mới nhất trước). */
export async function listStudentSessions(actor: Actor, input: { studentId: string }) {
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'sessions' });
  return prisma.session.findMany({
    where: { student_id: input.studentId },
    orderBy: { started_at: 'desc' },
    select: {
      id: true,
      subject: true,
      mode: true,
      opened_via: true,
      started_at: true,
      ended_at: true,
      end_reason: true,
      session_feedback: { select: { rating: true } },
      _count: { select: { turns: true, problems: true, flags: true } },
    },
  });
}

/**
 * Transcript nguyên văn của một phiên kèm mọi dữ liệu gốc: từng lượt, mọi llm_calls (request/response
 * đầy đủ), guard_verdicts (cả checker='code' và 'llm'), đề bài + lời giải dự tính, scope_snapshot, đánh giá.
 */
export async function getSessionTranscript(actor: Actor, input: { studentId: string; sessionId: string }) {
  // Học sinh không xem được: transcript gồm lời giải dự tính và đáp án (quy tắc cứng 1).
  assertParentOrAdmin(actor);
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: `sessions:${input.sessionId}` });
  const session = await prisma.session.findFirst({ where: { id: input.sessionId, student_id: input.studentId } });
  if (!session) throw new AuthorizationError('Không có phiên này');

  const turns = await prisma.turn.findMany({ where: { session_id: session.id }, orderBy: { seq: 'asc' } });
  const turnIds = turns.map((t) => t.id);
  const [llmCalls, guardVerdicts, problems, feedback, flags] = await Promise.all([
    prisma.llmCall.findMany({
      where: { OR: [{ session_id: session.id }, ...(turnIds.length ? [{ turn_id: { in: turnIds } }] : [])] },
      orderBy: { created_at: 'asc' },
    }),
    prisma.guardVerdict.findMany({ where: { session_id: session.id }, orderBy: [{ created_at: 'asc' }, { attempt: 'asc' }] }),
    prisma.problem.findMany({
      where: { session_id: session.id, student_id: input.studentId },
      orderBy: { created_at: 'asc' },
      include: { solution_plans: { orderBy: { created_at: 'asc' } } },
    }),
    prisma.sessionFeedback.findUnique({ where: { session_id: session.id }, select: { rating: true, created_at: true } }),
    prisma.flag.findMany({ where: { session_id: session.id, student_id: input.studentId }, orderBy: { created_at: 'asc' } }),
  ]);

  // Decimal → chuỗi để Server Component hiển thị nguyên giá trị, không làm tròn.
  const calls = llmCalls.map((c) => ({ ...c, cost_usd: c.cost_usd === null ? null : c.cost_usd.toString() }));
  return { session, turns, llmCalls: calls, guardVerdicts, problems, feedback, flags };
}

export type SessionTranscript = Awaited<ReturnType<typeof getSessionTranscript>>;

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  getParentOverview: { kind: 'self-account', call: (a) => getParentOverview(a) },
  listStudentSessions: { kind: 'student-scoped', call: (a, c) => listStudentSessions(a, { studentId: c.studentId }) },
  getSessionTranscript: {
    kind: 'student-scoped',
    call: (a, c) => getSessionTranscript(a, { studentId: c.studentId, sessionId: c.sessionId }),
  },
};
