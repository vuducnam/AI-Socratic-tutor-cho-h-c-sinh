import { z } from 'zod';
import { hitRateLimit } from '@/server/auth/rate-limit';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { speakTutorTurn } from '@/server/voice/tts';
import { TtsTurnNotFoundError, TtsUnavailableError } from '@/server/voice/voice-errors';
import { friendlyError, studentOr401 } from '../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mít đọc một lượt của mình (SPEC §10): xác thực học sinh → zod → domain → audio/wav. Chỉ lượt của Mít
// trong phiên của chính con; lượt khác (của con, của bạn khác, không tồn tại) đều là 404.
const TTS_LIMIT = { name: 'tts-student', limit: 300, windowSeconds: 3600 };
const bodySchema = z.object({ turnId: z.uuid() });
const NO_STORE = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  if (!(await hitRateLimit(TTS_LIMIT, actor.id)).allowed) {
    return json({ error: 'rate_limited', message: 'Mít đọc nhiều quá rồi, đợi một lát nhé.' }, 429);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid', message: 'Yêu cầu chưa hợp lệ.' }, 400);
  try {
    const spoken = await speakTutorTurn(actor, { studentId: actor.id, turnId: parsed.data.turnId });
    return new Response(new Uint8Array(spoken.audio), {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'audio/wav', 'Content-Length': String(spoken.audio.length) },
    });
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof TtsTurnNotFoundError) {
      return json({ error: 'not_found', message: 'Không có câu này để đọc.' }, 404);
    }
    if (err instanceof TtsUnavailableError) {
      console.warn('[tts]', err.message);
      return json({ error: 'tts_unavailable', message: 'Mít chưa đọc được, bạn đọc chữ nhé.' }, 503);
    }
    const e = friendlyError(err);
    console.error('[tts] lỗi', err);
    return e.code === 'error'
      ? json({ error: 'tts_unavailable', message: 'Mít chưa đọc được, bạn đọc chữ nhé.' }, 503)
      : json({ error: e.code, message: e.message }, e.status);
  }
}
