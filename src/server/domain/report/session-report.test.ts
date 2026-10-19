import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { seedStudentEverywhere } from '../../../../tests/helpers/seed-student-everywhere';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { buildSessionReport } from './build-session-report';
import { filterUnevidencedClaims, type Narrative } from './filter-unevidenced-claims';
import { computeSessionMetrics } from './metrics';

// SPEC §11.3, quy tắc cứng 4: số liệu do code tính; nhận định trỏ tới lượt của học sinh khác bị loại.
const system = mintActor('system', SYSTEM_ACTOR_ID);
afterEach(() => setGatewayDependencies({}));
afterAll(closeTestDatabases);

describe('computeSessionMetrics', () => {
  it('tính từ lượt, verdict, phản hồi', () => {
    const turn = (over: object) => ({ id: crypto.randomUUID(), role: 'tutor', turn_kind: 'normal', content: 'x', state_after: 'PROBE', scaffold_level: 0, problem_id: 'p1', signals: {}, ...over });
    const turns = [
      turn({ role: 'student', state_after: 'PROBE' }),
      turn({ id: 't-scope', scaffold_level: 1 }),
      turn({ role: 'student' }),
      turn({ scaffold_level: 3, signals: { guessing: true } }),
      turn({ role: 'student', turn_kind: 'transfer_answer', content: 'khi đi chợ' }),
      turn({ state_after: 'DONE' }),
    ];
    const m = computeSessionMetrics({
      turns,
      verdicts: [{ turn_id: 't-scope', verdict: 'block', reasons: ['SCOPE'] }],
      feedback: { rating: 'fun' },
      problemIds: ['p1'],
      openedVia: 'student',
    });
    expect(m.high_scaffold_rate).toMatchObject({ value: 1 });
    expect(m.abandon_rate).toMatchObject({ value: 0 });
    expect(m.guessing_rate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.scope_block_rate).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.fun_share).toMatchObject({ value: 1 });
    expect(m.transfer_answer_rate).toMatchObject({ value: 1 });
    expect(m.self_correction_rate).toMatchObject({ value: null, status: 'insufficient_data' });
  });
});

describe('lọc nhận định', () => {
  it('không có bằng chứng, bằng chứng của học sinh khác, câu trích không có thật → bị loại', () => {
    const n: Narrative = {
      summary: [
        { text: 'Con tự sửa lỗi', evidence_turn_ids: ['mine'], evidence_session_ids: [], quote: null },
        { text: 'Không bằng chứng', evidence_turn_ids: [], evidence_session_ids: [], quote: null },
        { text: 'Lượt của em khác', evidence_turn_ids: ['other'], evidence_session_ids: [], quote: null },
      ],
      student_reasoning_quotes: [{ text: 'Trích', evidence_turn_ids: ['mine'], evidence_session_ids: [], quote: 'câu bịa ra' }],
      concerns: [],
    };
    const r = filterUnevidencedClaims(n, { turnIds: new Set(['mine']), sessionIds: new Set(), turnText: new Map([['mine', 'Em tưởng số dài hơn là to hơn']]) });
    expect(r.narrative.summary.map((c) => c.text)).toEqual(['Con tự sửa lỗi']);
    expect(r.narrative.student_reasoning_quotes).toEqual([]);
    expect(r.dropped).toHaveLength(3);
  });
});

describe('buildSessionReport', () => {
  it('lưu metrics do code tính; nhận định trỏ tới lượt của học sinh khác bị loại', async () => {
    const a = await seedStudentEverywhere(appDb());
    const b = await seedStudentEverywhere(appDb());
    // Fixture đã có sẵn một báo cáo phiên; xoá để dựng báo cáo mới.
    await appDb().query(`DELETE FROM decisions WHERE student_id = $1`, [a.studentId]);
    await appDb().query(`DELETE FROM reports WHERE session_id = $1`, [a.sessionId]);
    setGatewayDependencies({
      primary: scriptedAnthropic([
        {
          summary: [
            { text: 'Con nêu cách nghĩ của mình', evidence_turn_ids: [a.turnIds[0]], evidence_session_ids: [a.sessionId], quote: null },
            { text: 'Nhận định mượn lượt của bạn khác', evidence_turn_ids: [b.turnIds[0]], evidence_session_ids: [], quote: null },
          ],
          student_reasoning_quotes: [{ text: 'Câu của con', evidence_turn_ids: [a.turnIds[0]], evidence_session_ids: [], quote: 'Con nghĩ 0,45 lớn hơn' }],
          concerns: [{ text: 'Con còn nhầm số dài hơn là lớn hơn', evidence_turn_ids: [a.turnIds[0]], evidence_session_ids: [], quote: null }],
        },
      ]).provider,
      fallback: null,
    });
    const reportId = await buildSessionReport(system, { studentId: a.studentId, sessionId: a.sessionId });
    const { rows } = await appDb().query('SELECT metrics, narrative, llm_call_id FROM reports WHERE id = $1', [reportId]);
    expect(rows[0].metrics.abandon_rate.value).toBe(1);
    expect(rows[0].narrative.summary.map((c: { text: string }) => c.text)).toEqual(['Con nêu cách nghĩ của mình']);
    expect(rows[0].narrative.student_reasoning_quotes).toHaveLength(1);
    expect(rows[0].narrative.concerns).toHaveLength(1);
    expect(rows[0].narrative.dropped).toHaveLength(1);
    const call = await appDb().query('SELECT purpose, student_id, session_id FROM llm_calls WHERE id = $1', [rows[0].llm_call_id]);
    expect(call.rows[0]).toEqual({ purpose: 'report_narrative', student_id: a.studentId, session_id: a.sessionId });
  });
});
