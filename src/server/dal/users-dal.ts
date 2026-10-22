import 'server-only';
import type { Actor } from './actor';
import { appendActorAccessLog } from './access-log-dal';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertAccountHolder, assertAdmin, assertSystem } from './role-guards';

// Tài khoản admin/phụ huynh. Không có hàm đăng ký: chỉ admin (hoặc script tạo admin đầu tiên) tạo
// tài khoản (quy tắc cứng 11). Mọi thao tác quản trị ghi access_log (quy tắc cứng 14).

export type UserRole = 'admin' | 'parent';

export interface LoginUser {
  id: string;
  role: UserRole;
  status: string;
  name: string;
  password_hash: string;
  totp_secret_enc: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Luồng đăng nhập: tìm tài khoản theo email (chưa có phiên). */
export async function findUserForLogin(email: string): Promise<LoginUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, role: true, status: true, name: true, password_hash: true, totp_secret_enc: true },
  });
  return user ? { ...user, role: user.role as UserRole } : null;
}

/** Luồng đăng nhập: đánh dấu đăng nhập thành công. */
export async function recordUserLogin(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { last_login_at: new Date() } });
}

/** Phiên: kiểm tài khoản còn hoạt động và đúng vai trò. */
export async function findActiveUser(userId: string): Promise<{ id: string; role: UserRole; name: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, status: true } });
  if (!user || user.status !== 'active') return null;
  return { id: user.id, role: user.role as UserRole, name: user.name };
}

export interface NewAccountInput {
  name: string;
  email: string;
  passwordHash: string;
}

export async function createParentAccount(actor: Actor, input: NewAccountInput): Promise<string> {
  assertAdmin(actor);
  const user = await prisma.user.create({
    data: {
      role: 'parent',
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      password_hash: input.passwordHash,
      created_by: actor.id,
    },
    select: { id: true },
  });
  await appendActorAccessLog(actor, { action: 'admin.create_parent', resource: `users:${user.id}` });
  return user.id;
}

/** Script `create-first-admin` (không có trang đăng ký). */
export async function createAdminAccount(actor: Actor, input: NewAccountInput): Promise<string> {
  assertSystem(actor);
  const user = await prisma.user.create({
    data: { role: 'admin', name: input.name.trim(), email: normalizeEmail(input.email), password_hash: input.passwordHash },
    select: { id: true },
  });
  await appendActorAccessLog(actor, { action: 'system.create_admin', resource: `users:${user.id}` });
  return user.id;
}

export async function listAccounts(actor: Actor) {
  assertAdmin(actor);
  return prisma.user.findMany({
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      status: true,
      created_at: true,
      last_login_at: true,
      totp_secret_enc: true,
      parent_links: { select: { student_id: true } },
    },
  });
}

export async function setAccountStatus(
  actor: Actor,
  input: { userId: string; status: 'active' | 'disabled' },
): Promise<void> {
  assertAdmin(actor);
  if (input.userId === actor.id && input.status === 'disabled') throw new Error('Không tự khoá tài khoản admin đang dùng');
  await prisma.user.update({ where: { id: input.userId }, data: { status: input.status } });
  await appendActorAccessLog(actor, { action: `admin.set_user_status:${input.status}`, resource: `users:${input.userId}` });
}

export async function resetAccountPassword(actor: Actor, input: { userId: string; passwordHash: string }): Promise<void> {
  assertAdmin(actor);
  await prisma.user.update({ where: { id: input.userId }, data: { password_hash: input.passwordHash } });
  await appendActorAccessLog(actor, { action: 'admin.reset_password', resource: `users:${input.userId}` });
}

/** Phụ huynh/admin tự đổi mật khẩu của mình (hash mới do tầng auth tạo sau khi kiểm mật khẩu cũ). */
export async function changeOwnPassword(actor: Actor, input: { passwordHash: string }): Promise<void> {
  assertAccountHolder(actor);
  await prisma.user.update({ where: { id: actor.id }, data: { password_hash: input.passwordHash } });
  await appendActorAccessLog(actor, { action: 'account.change_password', resource: `users:${actor.id}` });
}

export async function getOwnAccount(actor: Actor) {
  assertAccountHolder(actor);
  return prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { id: true, name: true, email: true, role: true, password_hash: true, totp_secret_enc: true },
  });
}

export async function setOwnTotpSecret(actor: Actor, input: { totpSecretEnc: string | null }): Promise<void> {
  assertAccountHolder(actor);
  await prisma.user.update({ where: { id: actor.id }, data: { totp_secret_enc: input.totpSecretEnc } });
  await appendActorAccessLog(actor, {
    action: input.totpSecretEnc ? 'account.enable_totp' : 'account.disable_totp',
    resource: `users:${actor.id}`,
  });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  normalizeEmail: { kind: 'no-actor', reason: 'hàm thuần chuẩn hoá email' },
  findUserForLogin: { kind: 'no-actor', reason: 'luồng đăng nhập, chưa có phiên; không chứa dữ liệu học sinh' },
  recordUserLogin: { kind: 'no-actor', reason: 'luồng đăng nhập sau khi xác thực mật khẩu' },
  findActiveUser: { kind: 'no-actor', reason: 'kiểm phiên đăng nhập; không chứa dữ liệu học sinh' },
  createParentAccount: {
    kind: 'admin-only',
    call: (a) => createParentAccount(a, { name: 'x', email: `x-${Date.now()}@test.local`, passwordHash: 'x' }),
  },
  createAdminAccount: {
    kind: 'system-only',
    call: (a) => createAdminAccount(a, { name: 'x', email: `y-${Date.now()}@test.local`, passwordHash: 'x' }),
  },
  listAccounts: { kind: 'admin-only', call: (a) => listAccounts(a) },
  setAccountStatus: {
    kind: 'admin-only',
    call: (a, c) => setAccountStatus(a, { userId: c.otherParentId, status: 'active' }),
  },
  resetAccountPassword: {
    kind: 'admin-only',
    call: (a, c) => resetAccountPassword(a, { userId: c.otherParentId, passwordHash: 'x' }),
  },
  changeOwnPassword: { kind: 'self-account', call: (a) => changeOwnPassword(a, { passwordHash: 'x' }) },
  getOwnAccount: { kind: 'self-account', call: (a) => getOwnAccount(a) },
  setOwnTotpSecret: { kind: 'self-account', call: (a) => setOwnTotpSecret(a, { totpSecretEnc: null }) },
};
