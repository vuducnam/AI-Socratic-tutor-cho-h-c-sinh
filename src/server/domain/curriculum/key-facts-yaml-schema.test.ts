import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCurriculumFile } from './curriculum-yaml-schema';
import { keyFactsLessonHash, KeyFactsSeedError, parseKeyFactsFile, parsePages } from './key-facts-yaml-schema';
import { parseSkillFile } from './skill-yaml-schema';

// Ý chính (SPEC §5d): đúng trang của bài, câu ngắn (không chép sách), cụm chấp nhận viết thường; hash đổi khi sửa.

const pages = new Map([['HG5.SGK.B15', [65, 66, 67, 68]]]);
const fact = (over: Record<string, unknown> = {}) => ({
  fact_id: 'HG5.SGK.B15.F1',
  statement: 'Chiến dịch diễn ra từ tháng 3 đến tháng 5.',
  kind: 'date',
  accept: ['tháng 3'],
  pages: '65',
  locator: 'mục 1',
  ...over,
});
const file = (facts: unknown[]) =>
  `subject: history_geography\ngrade: 5\nlessons:\n  - lesson_id: HG5.SGK.B15\n    approved: null\n    facts: ${JSON.stringify(facts)}\n`;

describe('key-facts-yaml-schema', () => {
  it('đọc số trang dạng đơn, khoảng và danh sách', () => {
    expect(parsePages('65')).toEqual([65]);
    expect(parsePages('48-49')).toEqual([48, 49]);
    expect(parsePages('65, 67')).toEqual([65, 67]);
    expect(parsePages('TCN')).toBeNull();
  });

  it('nhận ý chính hợp lệ', () => {
    const [lesson] = parseKeyFactsFile('f', file([fact()]), pages);
    expect(lesson).toMatchObject({ subject: 'history_geography', lesson_id: 'HG5.SGK.B15', approved: null, facts: [{ pages: '65' }] });
  });

  it('từ chối: ngoài trang của bài, câu quá dài, cụm chấp nhận viết hoa, fact_id sai bài, bài không có trong mục lục', () => {
    const problems = (facts: unknown[], map = pages) => {
      try {
        parseKeyFactsFile('f', file(facts), map);
        return [];
      } catch (err) {
        return (err as KeyFactsSeedError).problems;
      }
    };
    expect(problems([fact({ pages: '70' })]).join()).toMatch(/ngoài trang của bài/);
    expect(problems([fact({ statement: Array(26).fill('chữ').join(' ') })]).join()).toMatch(/quá 25 từ/);
    expect(problems([fact({ accept: ['Điện Biên Phủ'] })]).join()).toMatch(/viết thường/);
    expect(problems([fact({ fact_id: 'HG5.SGK.B14.F1' })]).join()).toMatch(/bắt đầu bằng HG5.SGK.B15.F/);
    expect(problems([fact()], new Map()).join()).toMatch(/không có trong mục lục/);
  });

  it('hash đổi khi sửa ý chính (phải duyệt lại)', () => {
    const base = { lesson_id: 'HG5.SGK.B15', objectives: [], facts: [fact()] as never };
    const edited = { ...base, facts: [fact({ statement: 'Câu khác.' })] as never };
    expect(keyFactsLessonHash(base)).not.toBe(keyFactsLessonHash(edited));
  });

  it('dữ liệu thật: data/key-facts/history_geography/grade5.yaml khớp mục lục, đủ 28 bài', () => {
    const skills = parseSkillFile('s', readFileSync('data/skills/history_geography/grade5.yaml', 'utf8'));
    const { lessons } = parseCurriculumFile('c', readFileSync('data/curriculum/history_geography/grade5.yaml', 'utf8'), {
      knownSkillIds: new Set(skills.map((s) => s.skill_id)),
      gradeSkillIds: skills.map((s) => s.skill_id),
    });
    const lessonPages = new Map(lessons.map((l) => [l.lesson_id, parsePages(l.source.pages ?? '') ?? []]));
    const parsed = parseKeyFactsFile('k', readFileSync('data/key-facts/history_geography/grade5.yaml', 'utf8'), lessonPages);
    expect(parsed.map((l) => l.lesson_id)).toEqual(lessons.map((l) => l.lesson_id));
    for (const l of parsed) {
      const isReview = lessons.find((x) => x.lesson_id === l.lesson_id)!.title === 'Ôn tập';
      expect(l.facts.length, l.lesson_id).toBe(isReview ? 0 : l.facts.length || 1);
    }
  });
});
