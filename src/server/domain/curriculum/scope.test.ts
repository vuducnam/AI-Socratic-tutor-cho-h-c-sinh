import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTermMatches } from '@/lib/term-pattern-matcher';
import { parseCurriculumFile } from './curriculum-yaml-schema';
import { renderCurriculumScope } from './render-curriculum-scope';
import { applyHomeworkExtension, computeScope, decideProblemScope, type ScopeSkill } from './scope';

// SPEC §5c.3 — ca bắt buộc: chưa đặt tiến độ; frontier ở bài đầu và cuối năm; preview và preview bị
// vượt qua; bài về nhà vượt tiến độ; chuyển lớp; thuật ngữ vừa đã học vừa thuộc danh sách lớp trên.
// Fixture: mục lục giả 10 bài (tests/fixtures/curriculum/fake-grade5.yaml), KHÔNG phải SGK thật.

const skills: ScopeSkill[] = [
  { skill_id: 'FX.NAT.ADD', subject: 'math', grade_introduced: 5 },
  { skill_id: 'FX.DEC.READ', subject: 'math', grade_introduced: 5 },
  { skill_id: 'FX.DEC.COMPARE', subject: 'math', grade_introduced: 5 },
  { skill_id: 'FX.DEC.ADD', subject: 'math', grade_introduced: 5 },
  { skill_id: 'FX.PCT', subject: 'math', grade_introduced: 5 },
  { skill_id: 'FX.FRAC.BASIC', subject: 'math', grade_introduced: 4 },
  { skill_id: 'FX.NEG', subject: 'math', grade_introduced: 6 },
];
const { lessons } = parseCurriculumFile('fake-grade5.yaml', readFileSync('tests/fixtures/curriculum/fake-grade5.yaml', 'utf8'), {
  knownSkillIds: new Set(skills.map((s) => s.skill_id)),
  gradeSkillIds: skills.filter((s) => s.grade_introduced === 5).map((s) => s.skill_id),
});
const beyondTerms = [
  { term: 'số âm', patterns: ['số âm'] },
  { term: 'tỉ số phần trăm', patterns: ['tỉ số phần trăm'] },
];
const scopeAt = (frontierLessonId: string | null, previewLessonIds: string[] = [], grade = 5) =>
  computeScope({ subject: 'math', grade, lessons, skills, beyondTerms, progress: frontierLessonId || previewLessonIds.length ? { frontierLessonId, previewLessonIds } : null });
const forbiddenNames = (s: ReturnType<typeof scopeAt>) => s.forbiddenTerms.map((t) => t.term);

describe('computeScope', () => {
  it('chưa đặt tiến độ: không có bài nào của lớp 5, chỉ skill lớp trước', () => {
    const s = scopeAt(null);
    expect(s.frontierLesson).toBeNull();
    expect(s.coveredLessonIds).toEqual([]);
    expect(s.allowedSkillIds).toEqual(['FX.FRAC.BASIC']);
    expect(forbiddenNames(s)).toContain('số thập phân');
  });

  it('frontier ở bài đầu năm', () => {
    const s = scopeAt('FX5.T1.B1');
    expect(s.coveredLessonIds).toEqual(['FX5.T1.B1']);
    expect(s.allowedSkillIds).toEqual(['FX.FRAC.BASIC', 'FX.NAT.ADD']);
  });

  it('frontier ở bài cuối năm: mọi bài đã học, không còn thuật ngữ lớp 5 bị cấm', () => {
    const s = scopeAt('FX5.T2.B10');
    expect(s.coveredLessonIds).toHaveLength(10);
    expect(forbiddenNames(s)).toEqual(['số âm']);
  });

  it('tiến độ trước chủ đề số thập phân → không có skill số thập phân, thuật ngữ của chủ đề bị chặn', () => {
    const s = scopeAt('FX5.T1.B2');
    expect(s.allowedSkillIds.some((id) => id.startsWith('FX.DEC'))).toBe(false);
    expect(findTermMatches('Hai số thập phân này, số nào lớn hơn?', s.forbiddenTerms)).not.toHaveLength(0);
    expect(s.forbiddenMethods).toContain('so sánh phần nguyên trước rồi từng hàng phần thập phân');
  });

  it('preview mở thêm đúng một bài; frontier vượt qua thì preview tự rời danh sách', () => {
    const withPreview = scopeAt('FX5.T1.B2', ['FX5.T1.B5']);
    expect(withPreview.previewLessonIds).toEqual(['FX5.T1.B5']);
    expect(withPreview.allowedSkillIds).toContain('FX.DEC.ADD');
    expect(withPreview.allowedSkillIds).not.toContain('FX.DEC.READ');
    const passed = scopeAt('FX5.T1.B6', ['FX5.T1.B5']);
    expect(passed.previewLessonIds).toEqual([]);
  });

  it('thuật ngữ vừa thuộc bài đã học vừa nằm trong danh sách lớp trên → đã học thắng', () => {
    // Bài 9 của fixture dạy "tỉ số phần trăm" — cũng có trong beyondTerms.
    expect(forbiddenNames(scopeAt('FX5.T1.B6'))).toContain('tỉ số phần trăm');
    expect(forbiddenNames(scopeAt('FX5.T2.B9'))).not.toContain('tỉ số phần trăm');
  });

  it('"phần trăm" đơn lẻ (Bài 3) không bị chặn khi chỉ cấm "tỉ số phần trăm"', () => {
    const s = scopeAt('FX5.T1.B3');
    expect(findTermMatches('0,45 đọc là bốn mươi lăm phần trăm', s.forbiddenTerms)).toEqual([]);
  });

  it('chuyển lớp: lên lớp 6 thì mọi bài lớp 5 coi như đã học, tiến độ lớp mới rỗng', () => {
    const s = scopeAt(null, [], 6);
    expect(s.allowedSkillIds).toEqual(expect.arrayContaining(['FX.DEC.COMPARE', 'FX.PCT', 'FX.FRAC.BASIC']));
    expect(s.allowedSkillIds).not.toContain('FX.NEG');
    expect(forbiddenNames(s)).not.toContain('số thập phân');
  });

  it('scopeHash ổn định và đổi khi tiến độ đổi', () => {
    expect(scopeAt('FX5.T1.B3').scopeHash).toBe(scopeAt('FX5.T1.B3').scopeHash);
    expect(scopeAt('FX5.T1.B3').scopeHash).not.toBe(scopeAt('FX5.T1.B4').scopeHash);
  });

  it('render {curriculum_scope} 4 dòng dùng tên tập sách, không dùng id', () => {
    const text = renderCurriculumScope(scopeAt('FX5.T1.B4'));
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toContain('Đã học tới: Toán 5 (fixture), Tập 1, So sánh số thập phân (fixture)');
    expect(text).not.toMatch(/: T1,/);
  });
});

describe('decideProblemScope', () => {
  const catalog = { lessons, skills };

  it('skill trong phạm vi → dạy', () => {
    expect(decideProblemScope(scopeAt('FX5.T1.B4'), { skillIds: ['FX.DEC.COMPARE'], origin: 'homework' }, catalog)).toEqual({ kind: 'in_scope' });
  });

  it('bài về nhà cùng lớp vượt tiến độ → mở phạm vi riêng bài (bài có seq nhỏ nhất chứa skill)', () => {
    const scope = scopeAt('FX5.T1.B2');
    const d = decideProblemScope(scope, { skillIds: ['FX.DEC.COMPARE'], origin: 'homework' }, catalog);
    expect(d.kind).toBe('homework_extension');
    if (d.kind !== 'homework_extension') return;
    // FX.DEC.COMPARE có ở Bài 4 và bài ôn tập Bài 7: gợi ý Bài 4, không phải bài ôn.
    expect(d.extension.lessonId).toBe('FX5.T1.B4');
    const effective = applyHomeworkExtension(scope, d.extension);
    expect(effective.allowedSkillIds).toContain('FX.DEC.COMPARE');
    expect(findTermMatches('so sánh hai số thập phân', effective.forbiddenTerms)).toEqual([]);
    // Snapshot gốc của phiên không đổi.
    expect(scope.allowedSkillIds).not.toContain('FX.DEC.COMPARE');
  });

  it('cùng đề nhưng do Mít tạo → từ chối', () => {
    expect(decideProblemScope(scopeAt('FX5.T1.B2'), { skillIds: ['FX.DEC.COMPARE'], origin: 'generated' }, catalog)).toMatchObject({
      kind: 'out_of_scope',
      reason: 'generated_not_covered',
    });
  });

  it('bài lớp trên hoặc skill không map được → từ chối', () => {
    expect(decideProblemScope(scopeAt('FX5.T2.B10'), { skillIds: ['FX.NEG'], origin: 'homework' }, catalog)).toMatchObject({ reason: 'beyond_grade' });
    expect(decideProblemScope(scopeAt('FX5.T2.B10'), { skillIds: ['FX.UNKNOWN'], origin: 'homework' }, catalog)).toMatchObject({
      reason: 'unmapped_skill',
    });
  });
});
