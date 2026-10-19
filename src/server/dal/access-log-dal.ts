import 'server-only';
import type { Actor } from './actor';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// access_log [AO]: chỉ có hàm append, không có update/delete (SPEC §3.3).

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AccessLogInput {
  actorType: Actor['type'] | 'anonymous';
  actorId?: string | null;
  studentId?: string | null;
  action: string;
  resource?: string | null;
  reason?: string | null;
  request?: RequestContext;
}

// Một số giá trị IP từ header có thể không hợp lệ cho kiểu inet: bỏ đi thay vì làm hỏng lượt ghi log.
function safeIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : null;
}

export async function appendAccessLog(input: AccessLogInput): Promise<void> {
  await prisma.accessLog.create({
    data: {
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      student_id: input.studentId ?? null,
      action: input.action,
      resource: input.resource ?? null,
      reason: input.reason ?? null,
      ip: safeIp(input.request?.ip),
      user_agent: input.request?.userAgent?.slice(0, 500) ?? null,
    },
  });
}

/** Ghi log thay mặt một actor đã xác thực. */
export async function appendActorAccessLog(
  actor: Actor,
  entry: { studentId?: string | null; action: string; resource?: string | null; request?: RequestContext },
): Promise<void> {
  await appendAccessLog({
    actorType: actor.type,
    actorId: actor.id,
    reason: actor.reason ?? null,
    ...entry,
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  appendAccessLog: { kind: 'no-actor', reason: 'chỉ ghi log (append-only), không đọc dữ liệu học sinh' },
  appendActorAccessLog: { kind: 'no-actor', reason: 'chỉ ghi log thay actor đã được hàm gọi kiểm quyền' },
};
