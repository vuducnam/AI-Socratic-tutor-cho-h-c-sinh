import 'server-only';
import type { Actor } from './actor';

// Mỗi module DAL export `authorizationFixtures` mô tả cách gọi TỪNG hàm export của nó. Test
// tests/dal/authorization-coverage.test.ts duyệt mọi module: hàm thiếu fixture → fail (hàm mới tự vào test);
// hàm có dữ liệu học sinh được gọi bằng phụ huynh KHÔNG liên kết → phải bị từ chối.

export interface FixtureContext {
  /** Học sinh mục tiêu, liên kết với linkedParentId. */
  studentId: string;
  linkedParentId: string;
  /** Một học sinh khác, liên kết với phụ huynh khác. */
  otherStudentId: string;
  otherParentId: string;
  adminId: string;
  sessionId: string;
}

type FixtureCall = (actor: Actor, ctx: FixtureContext) => Promise<unknown>;

export type AuthorizationFixture =
  /** Đọc/ghi dữ liệu một học sinh: phụ huynh không liên kết bị từ chối, phụ huynh liên kết được phép. */
  | { kind: 'student-scoped'; call: FixtureCall; linkedParentAllowed?: boolean }
  /** Chỉ admin (trong container admin). */
  | { kind: 'admin-only'; call: FixtureCall }
  /** Chỉ thao tác trên tài khoản của chính actor (phụ huynh/admin); học sinh bị từ chối. */
  | { kind: 'self-account'; call: FixtureCall }
  /** Chỉ worker/seed/script. */
  | { kind: 'system-only'; call: FixtureCall }
  /**
   * Không nhận actor: luồng đăng nhập trước khi có phiên, hoặc helper nội bộ mà hàm gọi nó đã kiểm quyền.
   * Bắt buộc ghi lý do; test kiểm hàm này không nhận actor làm tham số đầu.
   */
  | { kind: 'no-actor'; reason: string };

export type AuthorizationFixtures<M> = {
  [K in keyof M as M[K] extends (...args: never[]) => unknown ? K : never]: AuthorizationFixture;
};
