import { z } from 'zod';
import { hitRateLimit } from '@/server/auth/rate-limit';
import { MAX_IMAGE_BYTES } from '@/server/domain/input/sanitize-problem-image';
import { uploadProblemImage } from '@/server/domain/session/learn-flow';
import { friendlyError, studentOr401 } from '../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ảnh đề (quy tắc cứng 10): ≤ 5 MB, chỉ jpeg/png/webp theo magic bytes, re-encode bỏ EXIF/GPS, cắt vùng
// đề con chọn; rate limit theo học sinh. Trả đề đã đọc để con xác nhận (chưa giải).
const cropSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) });
const UPLOAD_LIMIT = { name: 'upload-student', limit: 20, windowSeconds: 3600 };

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  if (!(await hitRateLimit(UPLOAD_LIMIT, actor.id)).allowed) {
    return Response.json({ error: 'rate_limited', message: 'Con gửi nhiều ảnh quá, đợi một lát nhé.' }, { status: 429 });
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return Response.json({ error: 'too_large', message: 'Ảnh lớn quá (tối đa 5 MB).' }, { status: 413 });
  try {
    const form = await request.formData();
    const sessionId = z.uuid().parse(form.get('sessionId'));
    const file = form.get('image');
    if (!(file instanceof File)) return Response.json({ error: 'invalid', message: 'Chưa có ảnh.' }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: 'too_large', message: 'Ảnh lớn quá (tối đa 5 MB).' }, { status: 413 });
    const cropRaw = form.get('crop');
    const crop = typeof cropRaw === 'string' && cropRaw ? cropSchema.parse(JSON.parse(cropRaw)) : null;
    const result = await uploadProblemImage(actor, { studentId: actor.id, sessionId, bytes: new Uint8Array(await file.arrayBuffer()), crop });
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof z.ZodError) return Response.json({ error: 'invalid', message: 'Ảnh chưa hợp lệ.' }, { status: 400 });
    const e = friendlyError(err);
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
}
