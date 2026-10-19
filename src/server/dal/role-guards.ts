import 'server-only';
import type { Actor, AdminActor, ParentActor, SystemActor } from './actor';
import { AuthorizationError } from './actor-authorization';

// Kiểm vai trò ở runtime (kiểu TypeScript không đủ: Server Action nhận input từ client).

/** Thao tác quản trị chỉ chạy trong container admin (ADMIN_ENABLED=true) với actor admin. */
export function assertAdmin(actor: Actor): asserts actor is AdminActor {
  if (process.env.ADMIN_ENABLED !== 'true') throw new AuthorizationError('Chức năng quản trị không bật ở đây');
  if (actor.type !== 'admin') throw new AuthorizationError('Chỉ admin');
}

export function assertSystem(actor: Actor): asserts actor is SystemActor {
  if (actor.type !== 'system') throw new AuthorizationError('Chỉ tiến trình hệ thống');
}

/** Tài khoản đăng nhập bằng email (phụ huynh/admin) thao tác trên chính tài khoản mình. */
export function assertAccountHolder(actor: Actor): asserts actor is ParentActor | AdminActor {
  if (actor.type !== 'parent' && actor.type !== 'admin') throw new AuthorizationError('Chỉ tài khoản phụ huynh/admin');
}
