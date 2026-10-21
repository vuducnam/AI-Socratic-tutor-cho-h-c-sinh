import 'server-only';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Ý chính đã duyệt của các bài (SPEC §5d). Danh mục SGK dùng chung, không có dữ liệu học sinh. Chỉ trả ý chính
// đã duyệt: bài chưa duyệt không được dùng để dạy.

export interface KeyFactRow {
  fact_id: string;
  lesson_id: string;
  statement: string;
  kind: string;
  accept: string[];
  pages: string;
  locator: string;
}

export async function listApprovedKeyFacts(lessonIds: string[]): Promise<KeyFactRow[]> {
  if (!lessonIds.length) return [];
  const rows = await prisma.keyFact.findMany({
    where: { lesson_id: { in: lessonIds }, approved_by: { not: null } },
    select: { fact_id: true, lesson_id: true, statement: true, kind: true, accept: true, pages: true, locator: true },
  });
  // Thứ tự ổn định theo bài rồi số thứ tự ý (F1, F2, …, F10), không theo chuỗi.
  const num = (id: string) => Number(id.slice(id.lastIndexOf('.F') + 2));
  return rows.sort((a, b) => a.lesson_id.localeCompare(b.lesson_id) || num(a.fact_id) - num(b.fact_id));
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  listApprovedKeyFacts: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
};
