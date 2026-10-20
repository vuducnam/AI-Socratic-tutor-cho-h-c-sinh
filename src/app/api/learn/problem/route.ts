import { z } from 'zod';
import { confirmImageProblem, submitTypedProblem } from '@/server/domain/session/learn-flow';
import { sseResponse, studentOr401 } from '../../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nộp đề: gõ tay (text) hoặc xác nhận đề đọc từ ảnh (problemId + text). Stream SSE: status → result.
const bodySchema = z.object({
  sessionId: z.uuid(),
  text: z.string().trim().min(3).max(2000),
  problemId: z.uuid().optional(),
});

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid', message: 'Đề bài chưa hợp lệ.' }, { status: 400 });
  const { sessionId, text, problemId } = parsed.data;
  return sseResponse(async (send) => {
    send('status', { message: 'Mít đang đọc kỹ đề bài…' });
    const result = problemId
      ? await confirmImageProblem(actor, { studentId: actor.id, sessionId, problemId, text })
      : await submitTypedProblem(actor, { studentId: actor.id, sessionId, text });
    send('result', result);
  });
}
