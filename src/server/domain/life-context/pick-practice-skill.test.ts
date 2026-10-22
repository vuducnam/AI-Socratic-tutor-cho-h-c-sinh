import { describe, expect, it } from 'vitest';
import { pickPracticeSkill } from './pick-practice-skill';

// Đề luyện chỉ dùng skill đã học và có tình huống đã duyệt; ưu tiên bài vừa học gần nhất.

const lessons = [
  { lesson_id: 'L10', skill_ids: ['CONCEPT'] },
  { lesson_id: 'L11', skill_ids: ['COMPARE'] },
  { lesson_id: 'L20', skill_ids: ['SUBTRACT'] },
];
const ref = (lessonId: string, seq: number) => ({ lessonId, seq, book: 'Toán 5', title: lessonId });

describe('pickPracticeSkill', () => {
  it('ưu tiên skill của bài học gần nhất có tình huống đã duyệt', () => {
    const scope = { allowedSkillIds: ['CONCEPT', 'COMPARE', 'SUBTRACT'], recentLessons: [ref('L10', 10), ref('L20', 20), ref('L11', 11)] };
    expect(pickPracticeSkill({ scope, lessons, skillsWithContexts: new Set(['CONCEPT', 'COMPARE', 'SUBTRACT']) })).toBe('SUBTRACT');
  });

  it('bài gần nhất chưa có tình huống → lùi về bài trước', () => {
    const scope = { allowedSkillIds: ['CONCEPT', 'COMPARE', 'SUBTRACT'], recentLessons: [ref('L20', 20), ref('L11', 11)] };
    expect(pickPracticeSkill({ scope, lessons, skillsWithContexts: new Set(['COMPARE', 'CONCEPT']) })).toBe('COMPARE');
  });

  it('không chọn skill ngoài phạm vi dù có tình huống; không có gì dùng được → null', () => {
    const scope = { allowedSkillIds: ['CONCEPT'], recentLessons: [ref('L20', 20)] };
    expect(pickPracticeSkill({ scope, lessons, skillsWithContexts: new Set(['SUBTRACT']) })).toBeNull();
    expect(pickPracticeSkill({ scope, lessons, skillsWithContexts: new Set(['CONCEPT']) })).toBe('CONCEPT');
  });
});
