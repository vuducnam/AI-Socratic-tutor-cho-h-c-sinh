import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { CurriculumSeedError, parseBeyondScopeFile, parseCurriculumFile } from './curriculum-yaml-schema';
import { parseSkillFile } from './skill-yaml-schema';

// SPEC §5c.1 / CURRICULUM §8.1: seed từ chối các lỗi mục lục, mỗi lỗi nêu rõ file và bài.
const base = readFileSync('tests/fixtures/curriculum/fake-grade5.yaml', 'utf8');
const known = new Set(['FX.NAT.ADD', 'FX.DEC.READ', 'FX.DEC.COMPARE', 'FX.DEC.ADD', 'FX.PCT']);

type Doc = { lessons: Record<string, unknown>[]; books: unknown[] };
function variant(mutate: (doc: Doc) => void): string {
  const doc = parse(base) as Doc;
  mutate(doc);
  return stringify(doc);
}
function problems(text: string, gradeSkillIds?: string[]): string[] {
  try {
    parseCurriculumFile('variant.yaml', text, { knownSkillIds: known, gradeSkillIds });
  } catch (err) {
    if (err instanceof CurriculumSeedError) return err.problems;
    throw err;
  }
  return [];
}

describe('loader mục lục', () => {
  it('fixture hợp lệ, tên tập sách được tra từ books[]', () => {
    const { lessons } = parseCurriculumFile('fake.yaml', base, { knownSkillIds: known });
    expect(lessons).toHaveLength(10);
    expect(lessons[0]!.book).toBe('Toán 5 (fixture), Tập 1');
  });

  it('lesson thiếu official_url → lỗi', () => {
    const p = problems(variant((d) => delete (d.lessons[2]!.source as Record<string, unknown>).official_url));
    expect(p.join('\n')).toMatch(/FX5\.T1\.B3.*official_url/);
  });

  it('regex re: hỏng → lỗi', () => {
    const p = problems(variant((d) => (d.lessons[3]!.introduces_terms = [{ term: 'x', patterns: ['re:(hàng'] }])));
    expect(p.join('\n')).toMatch(/FX5\.T1\.B4.*Pattern không hợp lệ/);
  });

  it('lesson_id trùng, seq trùng, seq đứt quãng → lỗi', () => {
    expect(problems(variant((d) => (d.lessons[1]!.lesson_id = 'FX5.T1.B1'))).join('\n')).toMatch(/lesson_id trùng/);
    expect(problems(variant((d) => (d.lessons[1]!.seq = 1))).join('\n')).toMatch(/seq 1 trùng/);
    expect(problems(variant((d) => (d.lessons[9]!.seq = 12))).join('\n')).toMatch(/seq phải liên tục/);
  });

  it('book không có trong books[] → lỗi', () => {
    expect(problems(variant((d) => (d.lessons[0]!.book = 'T9'))).join('\n')).toMatch(/book "T9"/);
  });

  it('skill_ids trỏ tới skill không tồn tại → lỗi', () => {
    expect(problems(variant((d) => (d.lessons[0]!.skill_ids = ['NOPE.SKILL']))).join('\n')).toMatch(/không tồn tại NOPE\.SKILL/);
  });

  it('skill lớp 5 không thuộc bài nào → lỗi', () => {
    expect(problems(base, ['FX.DEC.READ', 'FX.ORPHAN'])).toEqual(['variant.yaml: skill FX.ORPHAN (lớp 5) không thuộc bài nào']);
  });

  it('cảnh báo khi pattern của bài sau khớp thuật ngữ đã học ở bài trước', () => {
    const text = variant((d) => (d.lessons[8]!.introduces_terms = [{ term: 'phần trăm', patterns: ['phần trăm'] }]));
    const { warnings } = parseCurriculumFile('v.yaml', text, { knownSkillIds: known });
    expect(warnings.some((w) => w.includes('FX5.T2.B9') && w.includes('hàng phần trăm'))).toBe(true);
  });
});

describe('dữ liệu thật trong repo', () => {
  it('data/curriculum/math/grade5.yaml và beyond-grade5.yaml đọc được', () => {
    const skillFile = 'data/skills/math/grade5.yaml';
    const skills = existsSync(skillFile) ? parseSkillFile(skillFile, readFileSync(skillFile, 'utf8')) : [];
    const { lessons } = parseCurriculumFile('data/curriculum/math/grade5.yaml', readFileSync('data/curriculum/math/grade5.yaml', 'utf8'), {
      knownSkillIds: new Set(skills.map((s) => s.skill_id)),
      gradeSkillIds: skills.filter((s) => s.grade_introduced === 5).map((s) => s.skill_id),
    });
    expect(lessons.length).toBeGreaterThan(0);
    expect(() => parseBeyondScopeFile('beyond', readFileSync('data/curriculum/math/beyond-grade5.yaml', 'utf8'))).not.toThrow();
  });
});
