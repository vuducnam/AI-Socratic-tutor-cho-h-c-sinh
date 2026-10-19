import 'server-only';
import type { SystemActor } from './actor';
import { prisma } from './client';

// Hàng đợi xoá file sau purge (không link học sinh, không thuộc TransparencyRegistry).

export async function listPendingFileDeletions(_actor: SystemActor, limit = 100) {
  return prisma.pendingFileDeletion.findMany({ orderBy: { created_at: 'asc' }, take: limit });
}

export async function completePendingFileDeletion(_actor: SystemActor, id: string): Promise<void> {
  await prisma.pendingFileDeletion.delete({ where: { id } });
}

export async function recordPendingFileDeletionFailure(_actor: SystemActor, id: string, error: string): Promise<void> {
  await prisma.pendingFileDeletion.update({
    where: { id },
    data: { attempts: { increment: 1 }, last_error: error.slice(0, 500) },
  });
}
