import { z } from 'zod';
import { runStudentTurn } from '@/server/domain/dialogue/run-turn';
import { assertTimeLeft, closeSession } from '@/server/domain/session/learn-flow';
import { rawSttFromPieces } from '@/server/voice/stt-receipt';
import { sseResponse, studentOr401 } from '../_lib/learn-route-helpers';
import { sttPiecesField } from '../_lib/stt-pieces-field';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Một lượt chat (SPEC §6): xác thực → zod → domain; stream SSE. idempotencyKey do client sinh.
// Tin nói (SPEC §10): `text` là chữ con đã xem/sửa sau STT; raw_stt (chữ STT nguyên bản) server tự ghép
// từ `sttPieces` có biên nhận hợp lệ, chỉ khi inputModality = voice.
const bodySchema = z.object({
  sessionId: z.uuid(),
  text: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(100),
  hint: z.boolean().optional(),
  responseTimeMs: z.number().int().min(0).max(3_600_000).optional(),
  inputModality: z.enum(['text', 'voice']).optional(),
  sttPieces: sttPiecesField,
});

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid', message: 'Tin nhắn chưa hợp lệ.' }, { status: 400 });
  const input = parsed.data;
  return sseResponse(async (send) => {
    const limit = await assertTimeLeft(actor, actor.id, input.sessionId);
    if (limit) {
      await closeSession(actor, { studentId: actor.id, sessionId: input.sessionId, reason: 'time_limit' });
      send('result', { timeUp: true, message: limit });
      return;
    }
    send('status', { message: 'Mít đang nghĩ…' });
    const turn = await runStudentTurn(actor, {
      studentId: actor.id,
      sessionId: input.sessionId,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      hintRequested: input.hint,
      responseTimeMs: input.responseTimeMs,
      inputModality: input.inputModality ?? 'text',
      rawStt:
        input.inputModality === 'voice'
          ? rawSttFromPieces({ studentId: actor.id, sessionId: input.sessionId, pieces: input.sttPieces, maxChars: 2000 })
          : null,
    });
    send('result', turn);
  });
}
