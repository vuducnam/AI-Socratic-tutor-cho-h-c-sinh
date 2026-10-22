import { z } from 'zod';
import { loadSubjects } from '@/server/domain/curriculum/subject-config';
import { startOrResumeSession } from '@/server/domain/session/learn-flow';
import { friendlyError, studentOr401 } from '../../_lib/learn-route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mở hoặc tiếp tục phiên của con (chặn khi chưa có tiến độ hoặc hết giờ trong ngày). Body tuỳ chọn { subject }:
// bỏ trống thì tiếp tục phiên đang mở, hoặc trả danh sách môn để con chọn khi có từ hai môn.
const bodySchema = z.object({ subject: z.string().refine((id) => loadSubjects().some((s) => s.id === id)).optional() });

export async function POST(request: Request) {
  const actor = await studentOr401();
  if (actor instanceof Response) return actor;
  const raw = await request.text().catch(() => '');
  let body: unknown = {};
  try {
    if (raw) body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, reason: 'invalid', message: 'Môn học chưa hợp lệ.' }, { status: 400 });
  try {
    return Response.json(await startOrResumeSession(actor, { studentId: actor.id, subject: parsed.data.subject }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const e = friendlyError(err);
    return Response.json({ ok: false, reason: e.code, message: e.message }, { status: e.status });
  }
}
