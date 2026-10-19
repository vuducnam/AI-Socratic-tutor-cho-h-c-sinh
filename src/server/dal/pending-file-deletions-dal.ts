import 'server-only';
import type { Actor } from './actor';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertSystem } from './role-guards';

// Hàng đợi xoá file sau purge (không link học sinh, không thuộc TransparencyRegistry).

export async function listPendingFileDeletions(actor: Actor, limit = 100) {
  assertSystem(actor);
  return prisma.pendingFileDeletion.findMany({ orderBy: { created_at: 'asc' }, take: limit });
}

export async function completePendingFileDeletion(actor: Actor, id: string): Promise<void> {
  assertSystem(actor);
  await prisma.pendingFileDeletion.delete({ where: { id } });
}

export async function recordPendingFileDeletionFailure(actor: Actor, id: string, error: string): Promise<void> {
  assertSystem(actor);
  await prisma.pendingFileDeletion.update({
    where: { id },
    data: { attempts: { increment: 1 }, last_error: error.slice(0, 500) },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  listPendingFileDeletions: { kind: 'system-only', call: (a) => listPendingFileDeletions(a) },
  completePendingFileDeletion: {
    kind: 'system-only',
    call: (a) => completePendingFileDeletion(a, '00000000-0000-0000-0000-000000000001'),
  },
  recordPendingFileDeletionFailure: {
    kind: 'system-only',
    call: (a) => recordPendingFileDeletionFailure(a, '00000000-0000-0000-0000-000000000001', 'x'),
  },
};
