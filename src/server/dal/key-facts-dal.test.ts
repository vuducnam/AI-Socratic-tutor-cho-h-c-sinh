import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyFactsLessonHash, type KeyFactLessonDef } from '@/server/domain/curriculum/key-facts-yaml-schema';
import { ensureFakeCurriculum } from '../../../tests/helpers/fake-curriculum-world';
import { closeTestDatabases } from '../../../tests/helpers/test-database';
import { SYSTEM_ACTOR_ID } from './actor';
import { listApprovedKeyFacts } from './key-facts-dal';
import { mintActor } from './mint-actor';
import { seedKeyFacts } from './seed/seed-key-facts';

// Ý chính chỉ được dùng khi bài đã duyệt và hash duyệt khớp nội dung hiện tại (SPEC §5d).

const system = mintActor('system', SYSTEM_ACTOR_ID);
const fact = (lesson: string, n: number, statement: string) => ({
  fact_id: `${lesson}.F${n}`,
  statement,
  kind: 'event' as const,
  accept: [`ý ${n}`],
  pages: '1',
  locator: 'đoạn đầu',
});

function lesson(lessonId: string, facts: KeyFactLessonDef['facts'], approval: 'valid' | 'stale' | null): KeyFactLessonDef {
  const base = { lesson_id: lessonId, subject: 'fx-math', objectives: [], question_styles: [], opinion_prompts_present: false, facts };
  const hash = approval === 'valid' ? keyFactsLessonHash(base) : 'hash-cu';
  return { ...base, approved: approval ? { by: 'fixture-approver@test.local', at: '2026-10-21', content_hash: hash } : null };
}

beforeAll(ensureFakeCurriculum);
afterAll(closeTestDatabases);

describe('key facts', () => {
  it('chỉ trả ý chính của bài đã duyệt với hash khớp; theo thứ tự F1, F2, …, F10', async () => {
    const approved = lesson('FX5.T1.B1', Array.from({ length: 10 }, (_, i) => fact('FX5.T1.B1', i + 1, `Ý ${i + 1}`)), 'valid');
    const stale = lesson('FX5.T1.B2', [fact('FX5.T1.B2', 1, 'Đã sửa sau khi duyệt')], 'stale');
    const pending = lesson('FX5.T1.B3', [fact('FX5.T1.B3', 1, 'Chưa duyệt')], null);
    const r = await seedKeyFacts(system, [approved, stale, pending]);
    expect(r).toEqual({ facts: 12, approvedLessons: 1, staleApprovals: ['FX5.T1.B2'] });

    const rows = await listApprovedKeyFacts(['FX5.T1.B1', 'FX5.T1.B2', 'FX5.T1.B3']);
    expect(rows.map((x) => x.fact_id)).toEqual(Array.from({ length: 10 }, (_, i) => `FX5.T1.B1.F${i + 1}`));
  });

  it('seed lại khi bỏ một ý khỏi YAML thì ý đó bị xoá khỏi bảng', async () => {
    const two = lesson('FX5.T1.B4', [fact('FX5.T1.B4', 1, 'Một'), fact('FX5.T1.B4', 2, 'Hai')], 'valid');
    await seedKeyFacts(system, [two]);
    const one = lesson('FX5.T1.B4', [fact('FX5.T1.B4', 1, 'Một')], 'valid');
    await seedKeyFacts(system, [one]);
    expect((await listApprovedKeyFacts(['FX5.T1.B4'])).map((x) => x.fact_id)).toEqual(['FX5.T1.B4.F1']);
  });
});
