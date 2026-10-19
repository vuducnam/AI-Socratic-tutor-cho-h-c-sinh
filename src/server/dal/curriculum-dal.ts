import 'server-only';
import type { ScopeLesson, ScopeSkill, ScopeTerm } from '@/server/domain/curriculum/scope';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Danh mục chương trình (mục lục, skill, thuật ngữ lớp trên): dữ liệu chung từ SGK, không phải dữ liệu
// học sinh, nên không cần actor.

export interface ScopeCatalog {
  lessons: ScopeLesson[];
  skills: ScopeSkill[];
  beyondTerms: ScopeTerm[];
}

export async function loadScopeCatalog(subject: string, grade: number): Promise<ScopeCatalog> {
  const [lessons, skills, beyond] = await Promise.all([
    prisma.curriculumLesson.findMany({ where: { subject, grade: { lte: grade }, seq: { gt: 0 } }, orderBy: [{ grade: 'asc' }, { seq: 'asc' }] }),
    prisma.skill.findMany({ where: { subject }, select: { skill_id: true, subject: true, grade_introduced: true } }),
    prisma.beyondScopeTerm.findMany({ where: { subject, for_grade: grade } }),
  ]);
  return {
    lessons: lessons.map((l) => ({
      lesson_id: l.lesson_id,
      subject: l.subject,
      grade: l.grade,
      seq: l.seq,
      book: l.book,
      title: l.title,
      skill_ids: l.skill_ids,
      introduces_terms: l.introduces_terms as unknown as ScopeTerm[],
      methods: l.methods,
    })),
    skills,
    beyondTerms: beyond.map((b) => ({ term: b.term, patterns: b.patterns })),
  };
}

/** Mục lục để chọn "con đã học đến bài…" trên màn hình tiến độ. */
export async function listLessons(subject: string, grade: number) {
  return prisma.curriculumLesson.findMany({
    where: { subject, grade, seq: { gt: 0 } },
    orderBy: { seq: 'asc' },
    select: { lesson_id: true, seq: true, book: true, topic: true, lesson_no: true, title: true, skill_ids: true },
  });
}

export async function listSubjectsWithCurriculum(grade: number): Promise<string[]> {
  const rows = await prisma.curriculumLesson.findMany({ where: { grade, seq: { gt: 0 } }, distinct: ['subject'], select: { subject: true } });
  return rows.map((r) => r.subject);
}

export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  loadScopeCatalog: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
  listLessons: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
  listSubjectsWithCurriculum: { kind: 'no-actor', reason: 'danh mục SGK dùng chung, không có dữ liệu học sinh' },
};
