import 'server-only';
import { keyFactsLessonHash, KeyFactsSeedError, type KeyFactLessonDef } from '@/server/domain/curriculum/key-facts-yaml-schema';
import type { Actor } from '../actor';
import type { AuthorizationFixture } from '../authorization-fixtures';
import { prisma } from '../client';
import { assertSystem } from '../role-guards';

// Seed ý chính (SPEC §5d). Trạng thái duyệt đi theo YAML, theo từng bài: approved.content_hash phải khớp hash ý
// chính hiện tại của bài, sai (sửa sau khi duyệt) → seed như chưa duyệt. approved.by (email) → users.id.
// Ý chính bị bỏ khỏi YAML thì xoá khỏi bảng (không có dữ liệu học sinh nào trỏ tới bảng này bằng khoá ngoài).

export async function seedKeyFacts(
  actor: Actor,
  lessons: KeyFactLessonDef[],
): Promise<{ facts: number; approvedLessons: number; staleApprovals: string[] }> {
  assertSystem(actor);
  const emails = [...new Set(lessons.flatMap((l) => (l.approved ? [l.approved.by.toLowerCase()] : [])))];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !idByEmail.has(e));
  if (missing.length) throw new KeyFactsSeedError(missing.map((e) => `approved.by ${e} không phải tài khoản có thật`));

  let facts = 0;
  let approvedLessons = 0;
  const staleApprovals: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const lesson of lessons) {
      const hash = keyFactsLessonHash(lesson);
      const valid = lesson.approved && lesson.approved.content_hash === hash;
      if (lesson.approved && !valid) staleApprovals.push(lesson.lesson_id);
      if (valid && lesson.facts.length) approvedLessons += 1;
      await tx.keyFact.deleteMany({ where: { lesson_id: lesson.lesson_id, fact_id: { notIn: lesson.facts.map((f) => f.fact_id) } } });
      for (const f of lesson.facts) {
        const data = {
          lesson_id: lesson.lesson_id,
          subject: lesson.subject,
          statement: f.statement,
          kind: f.kind,
          accept: f.accept,
          withhold: f.withhold ?? [],
          pages: f.pages,
          locator: f.locator,
          content_hash: hash,
          approved_by: valid ? idByEmail.get(lesson.approved!.by.toLowerCase())! : null,
          approved_at: valid ? new Date(lesson.approved!.at) : null,
        };
        await tx.keyFact.upsert({ where: { fact_id: f.fact_id }, create: { fact_id: f.fact_id, ...data }, update: data });
        facts += 1;
      }
    }
  });
  return { facts, approvedLessons, staleApprovals };
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  seedKeyFacts: { kind: 'system-only', call: (a) => seedKeyFacts(a, []) },
};
