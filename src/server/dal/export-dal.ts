import 'server-only';
import { REGISTERED_TABLES, TransparencyRegistry, type TableName } from '@/server/transparency/registry';
import type { Actor } from './actor';
import type { RequestContext } from './access-log-dal';
import { assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Đọc toàn bộ dữ liệu của một học sinh theo TransparencyRegistry để export (quy tắc cứng 2).
// Tên bảng, điều kiện và cột sắp xếp đều là hằng trong registry, chỉ student_id là tham số.

export type ExportRow = Record<string, unknown>;

async function readTable(table: TableName, studentId: string): Promise<ExportRow[]> {
  const entry = TransparencyRegistry[table];
  const omit = 'omitColumns' in entry ? entry.omitColumns.map((c) => ` - '${c}'`).join('') : '';
  // to_jsonb giữ đúng kiểu (số, thời gian dạng ISO, mảng, jsonb) mà không phải chuyển BigInt/Decimal.
  const rows = await prisma.$queryRawUnsafe<{ r: ExportRow }[]>(
    `SELECT to_jsonb(t)${omit} AS r FROM public."${table}" t WHERE ${entry.scope} ORDER BY ${entry.orderBy}`,
    studentId,
  );
  return rows.map((row) => row.r);
}

export async function readStudentExport(
  actor: Actor,
  { studentId, request }: { studentId: string; request?: RequestContext },
): Promise<Record<TableName, ExportRow[]>> {
  await assertStudentAccess(actor, studentId, { action: 'export', resource: 'all', request });
  const out = {} as Record<TableName, ExportRow[]>;
  for (const table of REGISTERED_TABLES) out[table] = await readTable(table, studentId);
  return out;
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  readStudentExport: { kind: 'student-scoped', call: (a, c) => readStudentExport(a, { studentId: c.studentId }) },
};
