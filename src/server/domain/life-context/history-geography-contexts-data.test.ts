import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { matchedPhrase } from '@/lib/key-point-matcher';
import { parseSkillFile } from '@/server/domain/curriculum/skill-yaml-schema';
import { knowledgeContextTemplateSchema, parseLifeContextFile } from './life-context-schema';

// Dữ liệu thật: tình huống Lịch sử và Địa lí 5 (SPEC §5d, quy tắc cứng 13) đọc được; mỗi ý chính mà câu hỏi kiểm có
// thật, thuộc đúng bài của skill, và còn ít nhất một cụm chấp nhận không nằm sẵn trong khung (code chấm được).

describe('data/life-contexts/history_geography/grade5.yaml', () => {
  it('khớp skill, ý chính và chấm được bằng code', () => {
    const skills = parseSkillFile('s', readFileSync('data/skills/history_geography/grade5.yaml', 'utf8'));
    const lessonOfSkill = new Map(skills.map((s) => [s.skill_id, `HG5.SGK.B${Number(/^Bài (\d+)\./.exec(s.source.lesson)![1])}`]));
    const contexts = parseLifeContextFile('c', readFileSync('data/life-contexts/history_geography/grade5.yaml', 'utf8'), new Set(skills.map((s) => s.skill_id)));
    const facts = new Map(
      (parse(readFileSync('data/key-facts/history_geography/grade5.yaml', 'utf8')) as { lessons: { facts: { fact_id: string; accept: string[] }[] }[] }).lessons.flatMap((l) =>
        l.facts.map((f) => [f.fact_id, f] as const),
      ),
    );
    expect(contexts.length).toBeGreaterThanOrEqual(100);
    for (const c of contexts) {
      const t = knowledgeContextTemplateSchema.parse(c.template);
      for (const id of t.fact_ids) {
        expect(id.startsWith(`${lessonOfSkill.get(c.skill_id)}.F`), `${c.id}: ${id} không thuộc bài của ${c.skill_id}`).toBe(true);
        const fact = facts.get(id);
        expect(fact, `${c.id}: không có ý ${id}`).toBeDefined();
        const free = fact!.accept.filter((a) => matchedPhrase(`${t.setup} ${t.real_question}`, { fact_id: id, accept: [a] }) === null);
        expect(free.length, `${c.id}: mọi cụm của ${id} đã nằm sẵn trong khung`).toBeGreaterThan(0);
      }
    }
  });
});
