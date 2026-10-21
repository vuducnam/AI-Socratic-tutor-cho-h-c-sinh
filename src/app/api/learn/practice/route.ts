import { z } from 'zod';
import { startPracticeProblem } from '@/server/domain/session/practice-problem';
import { sseResponse, studentOr401 } from '../../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Mít ra đề cho bạn": Mít tạo một đề tình huống đời thật cho bài con đã học. Stream SSE: status → result.
const bodySchema = z.object({ sessionId: z.uuid() });

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid', message: 'Yêu cầu chưa hợp lệ.' }, { status: 400 });
  return sseResponse(async (send) => {
    send('status', { message: 'Mít đang nghĩ một đề hay cho bạn…' });
    send('result', await startPracticeProblem(actor, { studentId: actor.id, sessionId: parsed.data.sessionId }));
  });
}
