import 'server-only';
import type { Theme } from '@/server/domain/life-context/life-context-schema';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertAccountHolder } from './role-guards';

// Thư viện tình huống (life_contexts): danh mục chung, không phải dữ liệu học sinh. Lịch sử dùng tình
// huống của một học sinh lấy từ problems (dữ liệu học sinh, cần quyền).

export async function listContextsForSkills(skillIds: string[]) {
  const rows = await prisma.lifeContext.findMany({ where: { skill_id: { in: skillIds } } });
  return rows.map((r) => ({ ...r, theme: r.theme as Theme }));
}

export async function getLifeContext(id: string) {
  return prisma.lifeContext.findUnique({ where: { id } });
}

/** Màn hình Duyệt (phụ huynh/admin): toàn bộ thư viện. */
export async function listLifeContextsForReview(actor: Actor) {
  assertAccountHolder(actor);
  return prisma.lifeContext.findMany({ orderBy: [{ skill_id: 'asc' }, { id: 'asc' }] });
}

export async function markLifeContextApproved(actor: Actor, input: { id: string; contentHash: string }): Promise<void> {
  assertAccountHolder(actor);
  const row = await prisma.lifeContext.findUnique({ where: { id: input.id }, select: { content_hash: true } });
  if (!row) throw new Error('Không có tình huống này');
  if (row.content_hash !== input.contentHash) throw new AuthorizationError('Nội dung đã đổi, mở lại để duyệt bản mới');
  await prisma.lifeContext.update({ where: { id: input.id }, data: { approved_by: actor.id, approved_at: new Date() } });
}

/** Tình huống con đã gặp gần đây (để xoay theme, không lặp 7 ngày). */
export async function recentContextUses(actor: Actor, input: { studentId: string; limit?: number }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'problems', log: actor.type !== 'student' });
  const rows = await prisma.problem.findMany({
    where: { student_id: input.studentId, life_context_id: { not: null } },
    orderBy: { created_at: 'desc' },
    take: input.limit ?? 30,
    select: { life_context_id: true, created_at: true, life_context: { select: { theme: true } } },
  });
  return rows.map((r) => ({ contextId: r.life_context_id!, theme: (r.life_context?.theme ?? 'other') as Theme, usedAt: r.created_at }));
}

export async function recordSessionFeedback(actor: Actor, input: { studentId: string; sessionId: string; rating: 'fun' | 'ok' | 'boring' }) {
  if (actor.type !== 'student' && actor.type !== 'system') throw new AuthorizationError('Chỉ học sinh chấm phiên');
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'session_feedback', log: actor.type !== 'student' });
  const session = await prisma.session.findUnique({ where: { id: input.sessionId }, select: { student_id: true } });
  if (session?.student_id !== input.studentId) throw new AuthorizationError('Không có phiên này');
  await prisma.sessionFeedback.upsert({
    where: { session_id: input.sessionId },
    create: { session_id: input.sessionId, student_id: input.studentId, rating: input.rating },
    update: { rating: input.rating },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  listContextsForSkills: { kind: 'no-actor', reason: 'danh mục tình huống dùng chung, không có dữ liệu học sinh' },
  getLifeContext: { kind: 'no-actor', reason: 'danh mục tình huống dùng chung, không có dữ liệu học sinh' },
  listLifeContextsForReview: { kind: 'self-account', call: (a) => listLifeContextsForReview(a) },
  markLifeContextApproved: { kind: 'self-account', call: (a) => markLifeContextApproved(a, { id: 'NOPE', contentHash: 'x' }) },
  recentContextUses: { kind: 'student-scoped', call: (a, c) => recentContextUses(a, { studentId: c.studentId }) },
  recordSessionFeedback: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => recordSessionFeedback(a, { studentId: c.studentId, sessionId: c.sessionId, rating: 'ok' }),
  },
};
