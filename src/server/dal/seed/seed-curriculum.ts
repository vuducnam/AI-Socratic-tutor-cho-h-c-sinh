import 'server-only';
import type { BeyondScopeTermDef, CurriculumLessonDef } from '@/server/domain/curriculum/curriculum-yaml-schema';
import type { Actor } from '../actor';
import type { AuthorizationFixture } from '../authorization-fixtures';
import { prisma } from '../client';
import { assertSystem } from '../role-guards';

// Ghi mục lục và thuật ngữ lớp trên (upsert theo lesson_id / (subject, for_grade, term)).
// lesson_id không đổi sau khi đã seed vì tiến độ của con trỏ tới id này (CURRICULUM §4.2).

export async function seedCurriculum(
  actor: Actor,
  input: { lessons: CurriculumLessonDef[]; beyondTerms: BeyondScopeTermDef[] },
): Promise<{ lessons: number; beyondTerms: number }> {
  assertSystem(actor);
  await prisma.$transaction(async (tx) => {
    // seq có unique(subject, grade, seq): dời tạm seq cũ sang âm để đổi thứ tự không đụng ràng buộc.
    const groups = new Set(input.lessons.map((l) => `${l.subject}|${l.grade}`));
    for (const g of groups) {
      const [subject, grade] = g.split('|') as [string, string];
      await tx.$executeRaw`UPDATE curriculum_lessons SET seq = -seq WHERE subject = ${subject} AND grade = ${Number(grade)} AND seq > 0`;
    }
    for (const l of input.lessons) {
      const data = {
        subject: l.subject,
        grade: l.grade,
        seq: l.seq,
        book: l.book,
        topic: l.topic ?? '',
        lesson_no: l.lesson_no,
        title: l.title,
        skill_ids: l.skill_ids,
        introduces_terms: l.introduces_terms,
        methods: l.methods,
        source: l.source,
      };
      await tx.curriculumLesson.upsert({ where: { lesson_id: l.lesson_id }, create: { lesson_id: l.lesson_id, ...data }, update: data });
    }
    for (const t of input.beyondTerms) {
      const data = {
        patterns: t.patterns,
        introduced_grade: t.introduced_grade,
        note: t.note ?? null,
        source: t.source,
      };
      await tx.beyondScopeTerm.upsert({
        where: { subject_for_grade_term: { subject: t.subject, for_grade: t.for_grade, term: t.term } },
        create: { subject: t.subject, for_grade: t.for_grade, term: t.term, ...data },
        update: data,
      });
    }
  });
  const stale = await prisma.curriculumLesson.count({ where: { seq: { lt: 0 } } });
  if (stale) console.warn(`[seed] ${stale} bài trong DB không còn trong YAML (seq âm) — kiểm lại trước khi xoá tay`);
  return { lessons: input.lessons.length, beyondTerms: input.beyondTerms.length };
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  seedCurriculum: { kind: 'system-only', call: (a) => seedCurriculum(a, { lessons: [], beyondTerms: [] }) },
};
