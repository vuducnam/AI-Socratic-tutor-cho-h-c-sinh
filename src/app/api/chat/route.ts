import { z } from 'zod';
import { runStudentTurn } from '@/server/domain/dialogue/run-turn';
import { assertTimeLeft, closeSession } from '@/server/domain/session/learn-flow';
import { sseResponse, studentOr401 } from '../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Một lượt chat (SPEC §6): xác thực → zod → domain; stream SSE. idempotencyKey do client sinh.
// Tin nói (SPEC §10): `text` là chữ con đã xem/sửa sau STT, `rawStt` là chữ STT nguyên bản — chỉ lưu
// khi inputModality = voice (tin gõ thì bỏ qua rawStt).
const bodySchema = z.object({
  sessionId: z.uuid(),
  text: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(100),
  hint: z.boolean().optional(),
  responseTimeMs: z.number().int().min(0).max(3_600_000).optional(),
  inputModality: z.enum(['text', 'voice']).optional(),
  // Cắt khoảng trắng; chuỗi rỗng coi như không có bản STT.
  rawStt: z.string().trim().max(2000).nullish().transform((v) => v || null),
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
      rawStt: input.inputModality === 'voice' ? input.rawStt : null,
    });
    send('result', turn);
  });
}
