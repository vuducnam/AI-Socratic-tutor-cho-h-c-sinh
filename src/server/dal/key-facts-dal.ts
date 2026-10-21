import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';
import { assertAccountHolder } from './role-guards';

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

/** Ý chính đã duyệt theo id (ý chính mà plan của bài đang làm trỏ tới). */
export async function listKeyFactsByIds(factIds: string[]): Promise<KeyFactRow[]> {
  if (!factIds.length) return [];
  const rows = await prisma.keyFact.findMany({
    where: { fact_id: { in: factIds }, approved_by: { not: null } },
    select: { fact_id: true, lesson_id: true, statement: true, kind: true, accept: true, pages: true, locator: true },
  });
  return factIds.flatMap((id) => rows.filter((r) => r.fact_id === id));
}

/** Màn hình Duyệt (phụ huynh/admin): ý chính theo bài, kèm tên bài, trạng thái duyệt và hash của bài. */
export async function listKeyFactsForReview(actor: Actor) {
  assertAccountHolder(actor);
  const rows = await prisma.keyFact.findMany({
    include: { lesson: { select: { title: true, seq: true, subject: true, grade: true } }, approver: { select: { name: true } } },
  });
  const num = (id: string) => Number(id.slice(id.lastIndexOf('.F') + 2));
  const lessons = new Map<string, { lessonId: string; title: string; seq: number; subject: string; contentHash: string; approvedAt: Date | null; approver: string | null; facts: typeof rows }>();
  for (const r of rows) {
    const l = lessons.get(r.lesson_id) ?? {
      lessonId: r.lesson_id,
      title: r.lesson.title,
      seq: r.lesson.seq,
      subject: r.lesson.subject,
      contentHash: r.content_hash,
      approvedAt: r.approved_at,
      approver: r.approver?.name ?? null,
      facts: [],
    };
    l.facts.push(r);
    lessons.set(r.lesson_id, l);
  }
  return [...lessons.values()]
    .map((l) => ({ ...l, facts: l.facts.sort((a, b) => num(a.fact_id) - num(b.fact_id)) }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.seq - b.seq);
}

/** Phụ huynh duyệt cả bài: hash phải khớp bản đang có trong DB (đã seed). */
export async function markKeyFactsLessonApproved(actor: Actor, input: { lessonId: string; contentHash: string }): Promise<void> {
  assertAccountHolder(actor);
  const rows = await prisma.keyFact.findMany({ where: { lesson_id: input.lessonId }, select: { content_hash: true } });
  if (!rows.length) throw new Error('Bài này chưa có ý chính');
  if (rows.some((r) => r.content_hash !== input.contentHash)) throw new AuthorizationError('Nội dung đã đổi, mở lại để duyệt bản mới');
  await prisma.keyFact.updateMany({ where: { lesson_id: input.lessonId }, data: { approved_by: actor.id, approved_at: new Date() } });
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  listApprovedKeyFacts: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
  listKeyFactsByIds: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
  listKeyFactsForReview: { kind: 'self-account', call: (a) => listKeyFactsForReview(a) },
  markKeyFactsLessonApproved: { kind: 'self-account', call: (a) => markKeyFactsLessonApproved(a, { lessonId: 'NOPE', contentHash: 'x' }) },
};
