import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertSystem } from './role-guards';

// Cờ cho phụ huynh (SPEC §3: flags). Cờ nào cũng hiện trong /parent; cờ severity cao và khoá PIN
// còn gửi email báo phụ huynh (job notify-parents trong worker).

export type FlagSeverity = 'info' | 'warning' | 'high';

export interface NewFlag {
  studentId: string;
  sessionId?: string | null;
  type: string;
  severity: FlagSeverity;
  detail?: Record<string, unknown>;
  evidenceTurnIds?: string[];
}

async function insertFlag(flag: NewFlag): Promise<string> {
  const row = await prisma.flag.create({
    data: {
      student_id: flag.studentId,
      session_id: flag.sessionId ?? null,
      type: flag.type,
      severity: flag.severity,
      detail: (flag.detail ?? {}) as object,
      evidence_turn_ids: flag.evidenceTurnIds ?? [],
    },
    select: { id: true },
  });
  return row.id;
}

/** Cờ phát sinh trong lượt học của chính học sinh, hoặc từ worker. */
export async function createFlag(actor: Actor, flag: NewFlag): Promise<string> {
  await assertStudentAccess(actor, flag.studentId, { action: 'write', resource: 'flags', log: actor.type !== 'student' });
  return insertFlag(flag);
}

/** Luồng đăng nhập (chưa có phiên): cờ khoá PIN. */
export async function createLoginSecurityFlag(
  studentId: string,
  type: 'pin_soft_locked' | 'pin_hard_locked',
  detail: Record<string, unknown>,
): Promise<string> {
  return insertFlag({ studentId, type, severity: type === 'pin_hard_locked' ? 'high' : 'warning', detail });
}

/** Worker gửi email: đọc cờ và email phụ huynh liên kết. */
export async function getFlagNotificationTargets(actor: Actor, input: { flagId: string }) {
  assertSystem(actor);
  const flag = await prisma.flag.findUniqueOrThrow({
    where: { id: input.flagId },
    select: { id: true, type: true, severity: true, student_id: true, created_at: true },
  });
  await assertStudentAccess(actor, flag.student_id, { action: 'notify', resource: `flags:${flag.id}` });
  const parents = await prisma.parentStudent.findMany({
    where: { student_id: flag.student_id, parent: { status: 'active' } },
    select: { parent: { select: { email: true, name: true } } },
  });
  return { flag, recipients: parents.map((p) => p.parent) };
}

export async function listFlags(actor: Actor, input: { studentId: string; onlyUnacknowledged?: boolean }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'flags', log: actor.type !== 'student' });
  return prisma.flag.findMany({
    where: { student_id: input.studentId, ...(input.onlyUnacknowledged ? { acknowledged_at: null } : {}) },
    orderBy: { created_at: 'desc' },
  });
}

export async function acknowledgeFlag(actor: Actor, input: { studentId: string; flagId: string }): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  await assertStudentAccess(actor, input.studentId, { action: 'acknowledge', resource: `flags:${input.flagId}` });
  await prisma.flag.updateMany({
    where: { id: input.flagId, student_id: input.studentId },
    data: { acknowledged_by: actor.id, acknowledged_at: new Date() },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  createFlag: {
    kind: 'student-scoped',
    call: (a, c) => createFlag(a, { studentId: c.studentId, type: 'fixture', severity: 'info' }),
  },
  createLoginSecurityFlag: { kind: 'no-actor', reason: 'luồng đăng nhập học sinh, chưa có phiên' },
  getFlagNotificationTargets: { kind: 'system-only', call: (a) => getFlagNotificationTargets(a, { flagId: '00000000-0000-0000-0000-000000000001' }) },
  listFlags: { kind: 'student-scoped', call: (a, c) => listFlags(a, { studentId: c.studentId }) },
  acknowledgeFlag: {
    kind: 'student-scoped',
    call: (a, c) => acknowledgeFlag(a, { studentId: c.studentId, flagId: '00000000-0000-0000-0000-000000000001' }),
  },
};
