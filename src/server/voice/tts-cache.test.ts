import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteStudentTtsCache, readTtsCache, ttsCacheKey, ttsCacheUriFor, writeTtsCache } from './tts-cache';

const stillThere = async () => true;

// Purge xoá cả thư mục cache giọng đọc của một học sinh, không đụng tới học sinh khác.
describe('deleteStudentTtsCache', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tts-cache-'));
    vi.stubEnv('TTS_CACHE_DIR', root);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('xoá thư mục của đúng học sinh, idempotent', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await writeTtsCache(a, ttsCacheKey('m', 'v', 'một'), new Uint8Array([1]), stillThere);
    await writeTtsCache(b, ttsCacheKey('m', 'v', 'hai'), new Uint8Array([2]), stillThere);
    await deleteStudentTtsCache(ttsCacheUriFor(a));
    await deleteStudentTtsCache(ttsCacheUriFor(a));
    expect(await readdir(root)).toEqual([b]);
  });

  it('URI không hợp lệ → từ chối (không xoá ra ngoài thư mục cache)', async () => {
    await expect(deleteStudentTtsCache('tts-cache:../..')).rejects.toThrow();
    await expect(deleteStudentTtsCache('storage:x')).rejects.toThrow();
  });
});

// Lượt TTS đang chạy khi phụ huynh xoá dữ liệu: file ghi xong sau purge không được ở lại trên đĩa.
describe('writeTtsCache và purge chạy song song', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tts-cache-race-'));
    vi.stubEnv('TTS_CACHE_DIR', root);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('hồ sơ còn → giữ file cache', async () => {
    const id = randomUUID();
    const key = ttsCacheKey('m', 'v', 'còn');
    await writeTtsCache(id, key, new Uint8Array([7]), stillThere);
    expect(await readTtsCache(id, key)).toEqual(Buffer.from([7]));
  });

  it('hồ sơ đã bị xoá khi ghi xong (sweeper đã chạy trước) → xoá cả thư mục vừa tạo lại', async () => {
    const id = randomUUID();
    await deleteStudentTtsCache(ttsCacheUriFor(id)); // sweeper chạy trước khi lượt TTS ghi xong
    await writeTtsCache(id, ttsCacheKey('m', 'v', 'muộn'), new Uint8Array([9]), async () => false);
    expect(await readdir(root)).toEqual([]);
  });

  it('không kiểm được hồ sơ (DB lỗi) → bỏ file vừa ghi, báo lỗi', async () => {
    const id = randomUUID();
    const key = ttsCacheKey('m', 'v', 'lỗi');
    await expect(
      writeTtsCache(id, key, new Uint8Array([1]), async () => {
        throw new Error('db down');
      }),
    ).rejects.toThrow('db down');
    expect(await readTtsCache(id, key)).toBeNull();
    expect(await readdir(join(root, id))).toEqual([]);
  });
});
