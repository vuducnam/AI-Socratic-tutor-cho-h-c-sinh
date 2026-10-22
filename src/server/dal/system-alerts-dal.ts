import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Cảnh báo hệ thống (không phải dữ liệu học sinh): credit 80%, gateway lỗi, thư viện tình huống cạn.
// `dedupeKey` giữ mỗi cảnh báo một dòng (vd. "credit80:2026-10").

export async function raiseSystemAlert(input: {
  type: string;
  severity: 'info' | 'warning' | 'high';
  detail?: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<void> {
  const data = { type: input.type, severity: input.severity, detail: (input.detail ?? {}) as object };
  if (input.dedupeKey) {
    await prisma.systemAlert.upsert({ where: { dedupe_key: input.dedupeKey }, create: { ...data, dedupe_key: input.dedupeKey }, update: {} });
  } else {
    await prisma.systemAlert.create({ data });
  }
}

/** Phụ huynh và admin đều thấy cảnh báo hệ thống (phase 16). */
export async function listSystemAlerts(actor: Actor, input: { onlyOpen?: boolean } = {}) {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError();
  return prisma.systemAlert.findMany({
    where: input.onlyOpen ? { acknowledged_at: null } : {},
    orderBy: { created_at: 'desc' },
    take: 100,
  });
}

export async function acknowledgeSystemAlert(actor: Actor, input: { alertId: string }): Promise<void> {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError();
  await prisma.systemAlert.updateMany({
    where: { id: input.alertId },
    data: { acknowledged_by: actor.id, acknowledged_at: new Date() },
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  raiseSystemAlert: { kind: 'no-actor', reason: 'ghi cảnh báo hệ thống, không chứa dữ liệu học sinh' },
  listSystemAlerts: { kind: 'self-account', call: (a) => listSystemAlerts(a) },
  acknowledgeSystemAlert: {
    kind: 'self-account',
    call: (a) => acknowledgeSystemAlert(a, { alertId: '00000000-0000-0000-0000-000000000001' }),
  },
};
