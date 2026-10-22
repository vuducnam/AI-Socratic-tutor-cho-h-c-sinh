import 'server-only';
import { hash, verify } from '@node-rs/argon2';

// Algorithm.Argon2id của @node-rs/argon2 là const enum (không dùng được với isolatedModules).
const ARGON2ID = 2;

// Mật khẩu phụ huynh/admin và PIN học sinh đều băm argon2id (SPEC §2.2).
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

export async function verifySecret(storedHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}

// Hash giả để thời gian xử lý tên đăng nhập không tồn tại giống khi tồn tại (không lộ tài khoản có thật).
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(secret: string): Promise<false> {
  dummyHash ??= hashSecret('cu-dummy-secret-for-timing');
  await verifySecret(await dummyHash, secret);
  return false;
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự`;
  if (password.length > 200) return 'Mật khẩu quá dài';
  return null;
}
