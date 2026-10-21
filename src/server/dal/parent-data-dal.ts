import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { ttsCacheUriFor } from '@/server/voice/tts-cache';

// Trang Dữ liệu của phụ huynh: xem access_log và xoá toàn bộ dữ liệu của con (SPEC §11.1, quy tắc cứng 2, 3, 14).

const ACCESS_LOG_LIMIT = 500;

/** Nhật ký truy cập dữ liệu của con, mới nhất trước; gồm dòng admin đọc kèm lý do. */
export async function listStudentAccessLog(actor: Actor, input: { studentId: string; limit?: number }) {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ phụ huynh/admin');
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'access_log' });
  const rows = await prisma.accessLog.findMany({
    where: { student_id: input.studentId },
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(input.limit ?? ACCESS_LOG_LIMIT, 1), ACCESS_LOG_LIMIT),
  });
  // BigInt → chuỗi để hiển thị/serialize được.
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

export class PurgeConfirmationError extends Error {
  constructor() {
    super('Tên gọi của con nhập vào không khớp, chưa xoá gì.');
    this.name = 'PurgeConfirmationError';
  }
}

/**
 * Xoá toàn bộ dữ liệu của con: chỉ phụ huynh liên kết. Bước xác nhận thứ hai là gõ đúng tên gọi của con;
 * DAL kiểm lại tên để Server Action gọi thẳng cũng không bỏ qua được bước này.
 * Tạo purge_requests rồi gọi purge_student() trong cùng transaction.
 */
export async function purgeStudentData(
  actor: Actor,
  input: { studentId: string; confirmDisplayName: string; reason?: string | null },
): Promise<void> {
  if (actor.type !== 'parent') throw new AuthorizationError('Chỉ phụ huynh được xoá dữ liệu của con');
  await assertStudentAccess(actor, input.studentId, { action: 'purge_request', resource: 'all' });
  const student = await prisma.student.findUniqueOrThrow({ where: { id: input.studentId }, select: { display_name: true } });
  if (input.confirmDisplayName.trim().normalize('NFC') !== student.display_name.trim().normalize('NFC')) {
    throw new PurgeConfirmationError();
  }
  await prisma.$transaction(async (tx) => {
    const request = await tx.purgeRequest.create({
      data: { student_id: input.studentId, requested_by: actor.id, reason: input.reason?.trim().slice(0, 500) || null },
      select: { id: true },
    });
    await tx.$executeRaw`SELECT purge_student(${request.id}::uuid)`;
    // Cache giọng đọc lời Mít (có thể gọi tên con) nằm trên đĩa: xoá sau commit, cùng hàng chờ với ảnh đề.
    await tx.pendingFileDeletion.create({ data: { uri: ttsCacheUriFor(input.studentId) } });
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  listStudentAccessLog: { kind: 'student-scoped', call: (a, c) => listStudentAccessLog(a, { studentId: c.studentId }) },
  // Phụ huynh liên kết KHÔNG gọi trong test phủ quyền (sẽ xoá học sinh fixture); test riêng ở tests/parent.
  purgeStudentData: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => purgeStudentData(a, { studentId: c.studentId, confirmDisplayName: 'x' }),
  },
};
