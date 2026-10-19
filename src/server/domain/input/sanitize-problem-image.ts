import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { detectImageType } from '@/server/storage/file-type';
import { writeStorageFile } from '@/server/storage/local-file-storage';

// Ảnh đề (quy tắc cứng 10, phase 15): chỉ nhận jpeg/png/webp theo magic bytes, ≤ 5 MB; cắt vùng đề con
// chọn (để tên con, tên trường trên phiếu không bị gửi đi); re-encode bằng sharp → mọi EXIF/GPS bị bỏ;
// giới hạn cạnh dài; tên file ngẫu nhiên; lưu ngoài web root.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE_PX = 2000;

export class ProblemImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProblemImageError';
  }
}

/** Vùng cắt theo tỉ lệ 0..1 của ảnh (client vẽ khung). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SanitizedImage {
  bytes: Buffer;
  mediaType: 'image/webp';
  storageUri: string;
  width: number;
  height: number;
}

export async function sanitizeProblemImage(input: Uint8Array, crop: CropRect | null): Promise<SanitizedImage> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ProblemImageError('Ảnh lớn quá (tối đa 5 MB)');
  if (!detectImageType(input)) throw new ProblemImageError('Chỉ nhận ảnh JPEG, PNG hoặc WebP');

  // rotate() theo EXIF trước khi bỏ metadata để ảnh không bị xoay ngang.
  let image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
  const meta = await image.metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!w || !h) throw new ProblemImageError('Không đọc được ảnh');

  if (crop) {
    const left = Math.max(0, Math.floor(crop.x * w));
    const top = Math.max(0, Math.floor(crop.y * h));
    const width = Math.min(w - left, Math.max(16, Math.floor(crop.width * w)));
    const height = Math.min(h - top, Math.max(16, Math.floor(crop.height * h)));
    image = sharp(await image.toBuffer()).extract({ left, top, width, height });
  }

  // sharp không giữ metadata (EXIF, GPS, ICC) trừ khi gọi withMetadata — cố ý không gọi.
  const { data, info } = await image
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const storageUri = await writeStorageFile(`problems/${randomUUID()}.webp`, data);
  return { bytes: data, mediaType: 'image/webp', storageUri, width: info.width, height: info.height };
}
