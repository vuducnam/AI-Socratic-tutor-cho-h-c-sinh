import { z } from 'zod';
import { hitRateLimit } from '@/server/auth/rate-limit';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { STT_LANGUAGES } from '@/server/dal/voice-prefs-dal';
import { sttConfig } from '@/server/llm/model-config';
import { baseAudioMime } from '@/server/voice/audio-format';
import { transcribeStudentAudio } from '@/server/voice/stt';
import { SttAudioTooLongError, SttUnavailableError, UnsupportedAudioError, VoiceSessionClosedError } from '@/server/voice/voice-errors';
import { friendlyError, studentOr401 } from '../_lib/learn-route-helpers';
import { readBodyWithLimit } from './read-body-with-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Giọng nói → chữ (SPEC §10, quy tắc cứng 10): xác thực học sinh → validate multipart → domain. Chữ trả
// về để con xem/sửa rồi mới gửi qua /api/chat (inputModality = voice). Audio không ghi đĩa.
const STT_LIMIT = { name: 'stt-student', limit: 120, windowSeconds: 3600 };
const UNAVAILABLE = { error: 'stt_unavailable', message: 'Mít chưa nghe rõ, bạn gõ chữ nhé.' };
// Phần đầu/ranh giới multipart và các trường chữ nằm ngoài giới hạn dung lượng audio (khớp stt-local).
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const fieldsSchema = z.object({ sessionId: z.uuid(), language: z.enum(STT_LANGUAGES) });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  if (!(await hitRateLimit(STT_LIMIT, actor.id)).allowed) {
    return json({ error: 'rate_limited', message: 'Bạn nói nhiều quá, đợi một lát nhé.' }, 429);
  }
  const maxBytes = sttConfig().max_bytes;
  const tooLarge = { error: 'too_large', message: 'Đoạn ghi âm dài quá, bạn nói ngắn hơn nhé.' };
  // Không đọc body không giới hạn vào bộ nhớ: có Content-Length thì chặn sớm theo nó, rồi luôn đếm byte thật khi
  // đọc (header có thể nói dối, hoặc vắng khi Cloudflare Tunnel chuyển sang chunked) — vượt là dừng đọc ngay.
  const declared = request.headers.get('content-length');
  const bodyLimit = maxBytes + MULTIPART_OVERHEAD_BYTES;
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > bodyLimit) return json(tooLarge, 413);
  const body = await readBodyWithLimit(request, bodyLimit);
  if (body === 'too_large') return json(tooLarge, 413);
  if (body === 'unreadable') return json({ error: 'invalid', message: 'Đoạn ghi âm chưa hợp lệ.' }, 400);

  let form: FormData;
  try {
    // Phân tích multipart từ bytes đã đọc (đã chặn kích thước), không đọc lại request.
    form = await new Response(body, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch {
    return json({ error: 'invalid', message: 'Đoạn ghi âm chưa hợp lệ.' }, 400);
  }
  const fields = fieldsSchema.safeParse({ sessionId: form.get('sessionId'), language: form.get('language') });
  const audio = form.get('audio');
  if (!fields.success || !(audio instanceof File) || audio.size === 0) {
    return json({ error: 'invalid', message: 'Đoạn ghi âm chưa hợp lệ.' }, 400);
  }
  if (audio.size > maxBytes) return json(tooLarge, 413);
  if (!baseAudioMime(audio.type)) return json({ error: 'unsupported_audio', message: 'Đoạn ghi âm chưa đúng định dạng.' }, 415);

  try {
    const result = await transcribeStudentAudio(actor, {
      studentId: actor.id,
      sessionId: fields.data.sessionId,
      audio: new Uint8Array(await audio.arrayBuffer()),
      mimeType: audio.type,
      language: fields.data.language,
    });
    return json(result);
  } catch (err) {
    if (err instanceof SttAudioTooLongError) return json({ error: 'too_long', message: err.friendlyMessage }, 413);
    if (err instanceof UnsupportedAudioError) return json({ error: 'unsupported_audio', message: err.message }, 415);
    if (err instanceof VoiceSessionClosedError) return json({ error: 'session_closed', message: 'Phiên học đã xong, bạn mở phiên mới nhé.' }, 409);
    if (err instanceof AuthorizationError) return json({ error: 'not_found', message: 'Không có phiên học này.' }, 404);
    if (err instanceof SttUnavailableError) {
      console.warn('[stt]', err.message);
      return json(UNAVAILABLE, 503);
    }
    const e = friendlyError(err);
    console.error('[stt] lỗi', err);
    // Lỗi khác (DB, mạng) với con vẫn là "chưa nghe rõ": con gõ chữ thay vì thấy lỗi kỹ thuật.
    return e.code === 'error' ? json(UNAVAILABLE, 503) : json({ error: e.code, message: e.message }, e.status);
  }
}
