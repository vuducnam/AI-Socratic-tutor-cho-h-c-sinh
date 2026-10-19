import { z } from 'zod';
import { recordSessionFeedback } from '@/server/dal/life-contexts-dal';
import { closeSession } from '@/server/domain/session/learn-flow';
import { friendlyError, studentOr401 } from '../../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cuối phiên: con chấm vui / bình thường / chán (session_feedback) rồi đóng phiên → báo cáo phiên.
const bodySchema = z.object({ sessionId: z.uuid(), rating: z.enum(['fun', 'ok', 'boring']).nullable(), end: z.boolean().default(true) });

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  try {
    if (parsed.data.rating) await recordSessionFeedback(actor, { studentId: actor.id, sessionId: parsed.data.sessionId, rating: parsed.data.rating });
    if (parsed.data.end) await closeSession(actor, { studentId: actor.id, sessionId: parsed.data.sessionId, reason: 'student_done' });
    return Response.json({ ok: true });
  } catch (err) {
    const e = friendlyError(err);
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
}
