import 'server-only';
import type { Actor } from './actor';
import { appendActorAccessLog, type RequestContext } from './access-log-dal';
import { prisma } from './client';

// Kiểm quyền trong DAL, không chỉ ở proxy (SPEC §3.3, quy tắc cứng 14):
// - student: chỉ dữ liệu của chính mình;
// - parent: chỉ học sinh được liên kết;
// - admin: học sinh liên kết, hoặc học sinh khác khi có `reason` (dòng log hiện cho phụ huynh của em đó);
// - system: worker/seed, luôn được nhưng vẫn ghi log khi đọc.

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message = 'Không có quyền truy cập dữ liệu này') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export async function isLinkedParent(userId: string, studentId: string): Promise<boolean> {
  const link = await prisma.parentStudent.findUnique({
    where: { parent_id_student_id: { parent_id: userId, student_id: studentId } },
    select: { parent_id: true },
  });
  return link !== null;
}

export interface StudentAccessOptions {
  /** Tên hành động ghi vào access_log, ví dụ "read", "write", "export". */
  action: string;
  /** Tài nguyên, ví dụ tên bảng hoặc màn hình. */
  resource: string;
  /** Học sinh tự đọc dữ liệu của mình không ghi log; phụ huynh, admin, system thì luôn ghi. */
  log?: boolean;
  request?: RequestContext;
}

/**
 * Ném AuthorizationError nếu actor không được truy cập học sinh. Ghi access_log cho mọi lượt truy cập
 * của phụ huynh, admin, system (SPEC §2.2 › Ghi log).
 */
export async function assertStudentAccess(
  actor: Actor,
  studentId: string,
  options: StudentAccessOptions,
): Promise<void> {
  switch (actor.type) {
    case 'student':
      if (actor.id !== studentId) throw new AuthorizationError();
      return;
    case 'parent':
      if (!(await isLinkedParent(actor.id, studentId))) throw new AuthorizationError();
      break;
    case 'admin': {
      const linked = await isLinkedParent(actor.id, studentId);
      if (!linked && !actor.reason?.trim()) {
        throw new AuthorizationError('Admin xem học sinh không liên kết phải nhập lý do');
      }
      break;
    }
    case 'system':
      break;
    default:
      throw new AuthorizationError();
  }
  if (options.log !== false) {
    await appendActorAccessLog(actor, {
      studentId,
      action: options.action,
      resource: options.resource,
      request: options.request,
    });
  }
}
