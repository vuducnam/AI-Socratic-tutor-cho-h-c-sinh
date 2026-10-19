import { startOrResumeSession } from '@/server/domain/session/learn-flow';
import { friendlyError, studentOr401 } from '../../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mở hoặc tiếp tục phiên Toán của con (chặn khi chưa có tiến độ hoặc hết giờ trong ngày).
export async function POST() {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  try {
    return Response.json(await startOrResumeSession(actor, { studentId: actor.id }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const e = friendlyError(err);
    return Response.json({ ok: false, reason: e.code, message: e.message }, { status: e.status });
  }
}
