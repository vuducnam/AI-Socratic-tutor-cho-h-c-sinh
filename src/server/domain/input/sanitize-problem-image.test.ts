import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveStorageUri } from '@/server/storage/local-file-storage';
import { ProblemImageError, sanitizeProblemImage } from './sanitize-problem-image';

// Quy tắc cứng 10: byte lưu trên đĩa (và byte gửi đi OCR) không còn EXIF/GPS; ảnh quá lớn hoặc file giả
// đuôi bị từ chối; vùng cắt được áp.

async function jpegWithGps(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 230 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'Cam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 1/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '105/1 50/1 0/1' },
    })
    .toBuffer();
}

beforeAll(() => {
  process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'cu-img-'));
});

describe('sanitizeProblemImage', () => {
  it('ảnh gốc có EXIF GPS → byte lưu và byte gửi đi không còn EXIF', async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await sanitizeProblemImage(input, null);
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
    const onDisk = readFileSync(resolveStorageUri(out.storageUri));
    expect((await sharp(onDisk).metadata()).exif).toBeUndefined();
    expect(onDisk.includes(Buffer.from('TestPhone'))).toBe(false);
    expect(out.storageUri).toMatch(/^storage:problems\/[0-9a-f-]{36}\.webp$/);
  });

  it('cắt đúng vùng con khoanh', async () => {
    const out = await sanitizeProblemImage(await jpegWithGps(1000, 1000), { x: 0.1, y: 0.2, width: 0.5, height: 0.25 });
    expect({ w: out.width, h: out.height }).toEqual({ w: 500, h: 250 });
  });

  it('ảnh quá 5 MB → từ chối', async () => {
    await expect(sanitizeProblemImage(new Uint8Array(50 * 1024 * 1024), null)).rejects.toBeInstanceOf(ProblemImageError);
  });

  it('file giả đuôi (không phải jpeg/png/webp theo magic bytes) → từ chối', async () => {
    const fake = new TextEncoder().encode('%PDF-1.4 không phải ảnh');
    await expect(sanitizeProblemImage(fake, null)).rejects.toThrow(/JPEG, PNG hoặc WebP/);
  });

  it('giới hạn cạnh dài', async () => {
    const big = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#fff' } }).png().toBuffer();
    const out = await sanitizeProblemImage(big, null);
    expect(Math.max(out.width, out.height)).toBe(2000);
  });
});
