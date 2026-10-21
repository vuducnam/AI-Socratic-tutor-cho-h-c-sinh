import { z } from 'zod';
import { confirmImageProblem, submitTypedProblem } from '@/server/domain/session/learn-flow';
import { rawSttFromPieces } from '@/server/voice/stt-receipt';
import { sseResponse, studentOr401 } from '../../_lib/learn-route-helpers';
import { sttPiecesField } from '../../_lib/stt-pieces-field';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nộp đề: gõ tay (text) hoặc xác nhận đề đọc từ ảnh (problemId + text). Stream SSE: status → result.
const bodySchema = z.object({
  sessionId: z.uuid(),
  text: z.string().trim().min(3).max(2000),
  problemId: z.uuid().optional(),
  // Đề đọc bằng giọng: chữ STT gốc ghép từ sttPieces có biên nhận (lưu vào problems.extracted_text để bố mẹ xem được).
  inputModality: z.enum(['text', 'voice']).optional(),
  sttPieces: sttPiecesField,
});

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid', message: 'Đề bài chưa hợp lệ.' }, { status: 400 });
  const { sessionId, text, problemId, inputModality, sttPieces } = parsed.data;
  const rawStt = inputModality === 'voice' ? rawSttFromPieces({ studentId: actor.id, sessionId, pieces: sttPieces, maxChars: 2000 }) : null;
  return sseResponse(async (send) => {
    send('status', { message: 'Mít đang đọc kỹ đề bài…' });
    const result = problemId
      ? await confirmImageProblem(actor, { studentId: actor.id, sessionId, problemId, text })
      : await submitTypedProblem(actor, { studentId: actor.id, sessionId, text, rawStt });
    send('result', result);
  });
}
