import { headers } from 'next/headers';
import { z } from 'zod';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { requestContextFromHeaders } from '@/server/auth/client-ip';
import { requireParentActor, UnauthenticatedError } from '@/server/auth/session';
import { buildStudentExportZip } from '@/server/transparency/export-student-zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ studentId: z.uuid() });

// Export toàn bộ dữ liệu một học sinh (JSON + CSV + file), chỉ phụ huynh liên kết (quy tắc cứng 2, 14).
export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  try {
    const actor = await requireParentActor();
    const { zip } = await buildStudentExportZip(actor, {
      studentId: parsed.data.studentId,
      request: requestContextFromHeaders(await headers()),
    });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(Buffer.from(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="cu-export-${date}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return Response.json({ error: 'unauthenticated' }, { status: 401 });
    if (err instanceof AuthorizationError) return Response.json({ error: 'forbidden' }, { status: 403 });
    throw err;
  }
}
