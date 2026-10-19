import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';

// TOTP tuỳ chọn cho admin/phụ huynh (khuyến nghị bật vì app mở công khai). Secret lưu mã hoá
// AES-256-GCM trong users.totp_secret_enc; khoá lấy từ TOTP_ENCRYPTION_KEY (hoặc SESSION_SECRET).

function encryptionKey(): Buffer {
  const material = process.env.TOTP_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!material) throw new Error('TOTP_ENCRYPTION_KEY chưa đặt');
  return createHash('sha256').update(`cu-totp:${material}`).digest();
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptTotpSecret(encoded: string): string {
  const [version, iv, tag, data] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('totp_secret_enc không hợp lệ');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, accountLabel: string): string {
  return generateURI({ issuer: 'Cú', label: accountLabel, secret });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = await verify({ secret, token: code });
    return result.valid;
  } catch {
    return false;
  }
}
