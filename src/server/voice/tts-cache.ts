import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { studentIdFromTtsCacheUri } from '@/server/storage/tts-cache-uri';

// Cache WAV lời của Mít trên đĩa (ngoài web root): TTS_CACHE_DIR/<student_id>/<sha256(model+voice+spoken)>.wav.
// Tách thư mục theo học sinh để xoá được toàn bộ khi purge (lời của Mít có thể gọi tên con).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f]{64}$/;

/** TTS_CACHE_DIR, mặc định <STORAGE_DIR>/tts-cache (dev: ./storage/tts-cache; Docker: volume /data/storage). */
export function ttsCacheRoot(): string {
  const dir = process.env.TTS_CACHE_DIR || join(process.env.STORAGE_DIR ?? './storage', 'tts-cache');
  return resolve(/*turbopackIgnore: true*/ dir);
}

/** Xoá cả thư mục cache của một học sinh (idempotent). Chỉ nhận URI do ttsCacheUriFor tạo. */
export async function deleteStudentTtsCache(uri: string): Promise<void> {
  await rm(join(ttsCacheRoot(), studentIdFromTtsCacheUri(uri)), { recursive: true, force: true });
}

/** Khoá cache: sha256 của [model, voice, spoken] (JSON để không nhập nhằng ranh giới giữa các phần). */
export function ttsCacheKey(model: string, voice: string, spoken: string): string {
  return createHash('sha256').update(JSON.stringify([model, voice, spoken])).digest('hex');
}

function cachePath(studentId: string, key: string): string {
  // Chặn path traversal: studentId là UUID, key là hex sha256.
  if (!UUID_RE.test(studentId) || !KEY_RE.test(key)) throw new Error('Khoá cache TTS không hợp lệ');
  return join(ttsCacheRoot(), studentId.toLowerCase(), `${key}.wav`);
}

/** Bytes WAV đã cache, hoặc null nếu chưa có. Lỗi đọc khác (quyền, đĩa) coi như miss và ghi log. */
export async function readTtsCache(studentId: string, key: string): Promise<Buffer | null> {
  try {
    const data = await readFile(cachePath(studentId, key));
    return data.length > 0 ? data : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[tts] đọc cache lỗi', err);
    return null;
  }
}

/** Hồ sơ học sinh còn dùng được không (DAL); null/false nghĩa là đã bị xoá (purge) hoặc khoá. */
export type StudentStillExists = (studentId: string) => Promise<boolean>;

/**
 * Ghi qua file tạm rồi rename để request song song không đọc phải file ghi dở.
 *
 * Chống race với purge: một lượt TTS đang chạy có thể ghi file SAU khi worker đã xoá thư mục cache của
 * học sinh vừa bị xoá dữ liệu → file mồ côi có lời gọi tên con. Vì vậy SAU khi rename mới hỏi DAL hồ sơ
 * còn không; không còn thì xoá cả thư mục vừa (tái) tạo. Kiểm sau rename là đủ: nếu lần kiểm thấy hồ sơ
 * còn thì purge chưa commit, nên hàng chờ xoá (tạo trong cùng transaction purge) sẽ chạy sau và xoá file
 * này; nếu thấy mất thì chính hàm này xoá. Kiểm trước rename thì còn kẽ hở giữa lần kiểm và lần rename.
 */
export async function writeTtsCache(studentId: string, key: string, audio: Uint8Array, studentStillExists: StudentStillExists): Promise<void> {
  const target = cachePath(studentId, key);
  const dir = join(ttsCacheRoot(), studentId.toLowerCase());
  const tmp = `${target}.${randomUUID()}.tmp`;
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(tmp, audio);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  let exists: boolean;
  try {
    exists = await studentStillExists(studentId);
  } catch (err) {
    // Không kiểm được (DB lỗi): bỏ file vừa ghi cho chắc, lần sau tổng hợp lại.
    await rm(target, { force: true });
    throw err;
  }
  if (!exists) await rm(dir, { recursive: true, force: true });
}
