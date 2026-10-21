import 'server-only';
import type { CurriculumScope, ScopeLesson } from '@/server/domain/curriculum/scope';

// Chọn skill cho đề luyện "Mít ra đề cho bạn" bằng CODE: chỉ skill trong phạm vi đã học (quy tắc cứng 15) và có
// tình huống đời thật đã duyệt (quy tắc cứng 13). Ưu tiên bài con vừa học gần nhất trên lớp, để luyện đúng điều
// đang học; bài gần nhất không có tình huống nào thì lùi dần về các bài trước.

export function pickPracticeSkill(input: {
  scope: Pick<CurriculumScope, 'allowedSkillIds' | 'recentLessons'>;
  lessons: Pick<ScopeLesson, 'lesson_id' | 'skill_ids'>[];
  /** Skill có ít nhất một context đã duyệt, đúng lớp. */
  skillsWithContexts: Set<string>;
  random?: () => number;
}): string | null {
  const random = input.random ?? Math.random;
  const allowed = new Set(input.scope.allowedSkillIds);
  const usable = (ids: string[]) => ids.filter((id) => allowed.has(id) && input.skillsWithContexts.has(id));
  const pick = (ids: string[]) => ids[Math.floor(random() * ids.length)]!;

  const recent = [...input.scope.recentLessons].sort((a, b) => b.seq - a.seq);
  for (const ref of recent) {
    const lesson = input.lessons.find((l) => l.lesson_id === ref.lessonId);
    const ids = lesson ? usable(lesson.skill_ids) : [];
    if (ids.length) return pick(ids);
  }
  const all = usable(input.scope.allowedSkillIds);
  return all.length ? pick(all) : null;
}
