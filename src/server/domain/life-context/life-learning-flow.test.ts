import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProblem } from '@/server/dal/problems-dal';
import { openProblemTurn, runStudentTurn } from '@/server/domain/dialogue/run-turn';
import { presolveProblem, setDefaultVerifier } from '@/server/domain/presolve/presolve';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeCurriculum, studentWithSession } from '../../../../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { valuesWithinRanges } from './fill-variables';
import { lifeContextTemplateSchema } from './life-context-schema';

// SPEC §15.10b: mọi phiên mở bằng hook và khép bằng transfer_question; bài về nhà hiển thị đúng
// confirmed_text; bài tương tự ở PARALLEL luôn có life_context_id đã duyệt, số nằm trong khoảng variables;
// thư viện cạn → ở lại SCAFFOLD(3) + system_alert. Hồ sơ giả, output model dựng sẵn.

const HOMEWORK = 'Số nào lớn hơn: 0,45 hay 0,5?';
const PLAN: SolutionPlan = {
  steps: [{ step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'So hàng phần mười', expected_result: '5 > 4', hint_question: 'Hàng phần mười của mỗi số là mấy?' }],
  final_answer: { value: '0,5 > 0,45', canonical: '>', kind: 'relation', choice_label: null },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: [],
  sympy_check: { kind: 'relation', expression: '0.5 > 0.45', expected: '>' },
  given_numbers: ['0,45', '0,5'],
};
const PARALLEL_TEXT = 'Bạn An nhảy xa 3,25 m, bạn Bình nhảy xa 3,4 m. Ai nhảy xa hơn?';
const PARALLEL_PLAN: SolutionPlan = {
  steps: [{ step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'So 3,25 và 3,4', expected_result: '3,4 > 3,25', hint_question: 'Phần nguyên hai số thế nào?' }],
  final_answer: { value: 'Bình', canonical: '1', kind: 'choice', choice_label: 'Bình' },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: [],
  sympy_check: { kind: 'choice', expression: 'argmax(3.25, 3.4)', expected: '1' },
  given_numbers: ['3,25', '3,4'],
};
const TEMPLATE = {
  setup: 'Bạn An nhảy xa {a}, bạn Bình nhảy xa {b}.',
  real_question: 'Ai nhảy xa hơn?',
  variables: { a: { min: 3.25, max: 3.25, step: 0.05, unit: 'm' }, b: { min: 3.4, max: 3.4, step: 0.05, unit: 'm' } },
  answer_expression: 'b - a',
  max_answer_decimals: 2,
  conditions: [],
  svg_kind: 'segment_bar',
};
const tutor = (message: string) => ({ message, short_message: message, question_type: 'clarify', step_addressed: 's1', student_state_guess: 'stuck' });
const PASS = { verdict: 'pass', reasons: [], explanation: '' };

async function setApprovedParallelContext(approved: boolean) {
  await appDb().query(
    `INSERT INTO life_contexts (id, skill_id, theme, template, min_grade, max_grade, safety, content_hash, approved_by, approved_at)
     VALUES ('FX.CTX.JUMP', 'FX.DEC.COMPARE', 'sport', $1, 5, 5, '{"adult_required":false,"notes":""}', 'fixture',
             (SELECT id FROM users WHERE email = 'fixture-approver@test.local'), now())
     ON CONFLICT (id) DO UPDATE SET approved_by = EXCLUDED.approved_by, approved_at = now()`,
    [JSON.stringify(TEMPLATE)],
  );
  if (!approved) await appDb().query(`UPDATE life_contexts SET approved_by = NULL, approved_at = NULL WHERE skill_id = 'FX.DEC.COMPARE'`);
}

async function homeworkWorld() {
  const w = await studentWithSession('FX5.T1.B4');
  const problemId = await createProblem(w.student, { studentId: w.studentId, sessionId: w.sessionId, origin: 'homework', confirmedText: HOMEWORK, confirmedByStudent: true });
  setGatewayDependencies({ primary: scriptedAnthropic([PLAN]).provider, fallback: null });
  const p = await presolveProblem(w.student, { studentId: w.studentId, sessionId: w.sessionId, problemId, problemText: HOMEWORK, origin: 'homework', sessionScope: w.scope, catalog: w.catalog });
  if (!p.ok) throw new Error('presolve phải đạt');
  return { ...w, problemId };
}

const say = (w: Awaited<ReturnType<typeof homeworkWorld>>, text: string, extra = {}) =>
  runStudentTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId, text, idempotencyKey: crypto.randomUUID(), responseTimeMs: 9000, ...extra });

beforeAll(async () => {
  await ensureFakeCurriculum();
  setDefaultVerifier(async () => ({ ok: true, computed: 'x', detail: 'match' }));
});
beforeEach(resetTestRedis);
afterEach(() => setGatewayDependencies({}));
afterAll(async () => {
  setDefaultVerifier(null);
  await closeTestDatabases();
});

describe('học từ đời sống', () => {
  it('mở bài bằng lượt hook; bài về nhà giữ nguyên đề (confirmed_text) trong mọi prompt', async () => {
    const w = await homeworkWorld();
    const scripted = scriptedAnthropic([{ hook: 'Ở sân trường các bạn hay thi nhảy xa đấy.' }, PASS, tutor('Đề hỏi gì nhỉ?'), PASS]);
    setGatewayDependencies({ primary: scripted.provider, fallback: null });
    const r = await openProblemTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId });
    expect(r.before?.[0]).toMatchObject({ kind: 'hook', content: 'Ở sân trường các bạn hay thi nhảy xa đấy.' });
    const kinds = await appDb().query(`SELECT turn_kind FROM turns WHERE session_id = $1 ORDER BY seq`, [w.sessionId]);
    expect(kinds.rows.map((k) => k.turn_kind)).toEqual(['hook', 'normal']);
    const problem = await appDb().query(`SELECT confirmed_text FROM problems WHERE id = $1`, [w.problemId]);
    expect(problem.rows[0].confirmed_text).toBe(HOMEWORK);
    // Đề hiển thị cho con (trong prompt Tutor) trùng nguyên văn đề trong solution_plans/problems.
    const tutorRequest = JSON.stringify(scripted.requests[2]!.system);
    expect(tutorRequest).toContain(`<problem>${HOMEWORK}</problem>`);
  });

  it('bế tắc ở SCAFFOLD(3) → PARALLEL với bài tình huống từ context đã duyệt, số trong khoảng; giải xong quay về bài gốc', async () => {
    await setApprovedParallelContext(true);
    const w = await homeworkWorld();
    setGatewayDependencies({ primary: scriptedAnthropic([{ hook: 'Mít kể chuyện nhảy xa nhé.' }, PASS, tutor('Đề hỏi gì?'), PASS]).provider, fallback: null });
    await openProblemTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId });

    const outputs: object[] = [];
    for (let i = 0; i < 4; i++) outputs.push(tutor('Con thử nghĩ thêm nhé?'), PASS);
    outputs.push({ problem_text: PARALLEL_TEXT }, PARALLEL_PLAN, PASS);
    setGatewayDependencies({ primary: scriptedAnthropic(outputs).provider, fallback: null });
    await say(w, 'con chịu');
    for (let i = 0; i < 3; i++) await say(w, 'gợi ý', { hintRequested: true });
    const r = await say(w, 'gợi ý', { hintRequested: true });
    expect(r).toMatchObject({ state: 'PARALLEL', message: PARALLEL_TEXT });

    const parallel = await appDb().query(
      `SELECT p.origin, p.life_context_id, p.context_variables, lc.approved_by FROM problems p JOIN life_contexts lc ON lc.id = p.life_context_id
       WHERE p.session_id = $1 AND p.origin = 'generated'`,
      [w.sessionId],
    );
    expect(parallel.rows).toHaveLength(1);
    expect(parallel.rows[0].approved_by).toBeTruthy();
    expect(valuesWithinRanges(lifeContextTemplateSchema.parse(TEMPLATE), parallel.rows[0].context_variables.values)).toBe(true);

    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Giờ quay lại bài đầu: hàng phần mười của 0,45 là mấy?'), PASS]).provider, fallback: null });
    const back = await say(w, 'bạn Bình ạ');
    expect(back).toMatchObject({ state: 'PROBE', scaffoldLevel: 3 });
    const last = await appDb().query(`SELECT problem_id FROM turns WHERE id = $1`, [back.tutorTurnId]);
    expect(last.rows[0].problem_id).toBe(w.problemId);
  });

  it('thư viện cạn (không có context đã duyệt) → ở lại SCAFFOLD(3), có system_alert, không sinh bài trơn', async () => {
    await setApprovedParallelContext(false);
    const w = await homeworkWorld();
    setGatewayDependencies({ primary: scriptedAnthropic([{ hook: 'Chuyện nhảy xa.' }, PASS, tutor('Đề hỏi gì?'), PASS]).provider, fallback: null });
    await openProblemTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId });
    const outputs: object[] = [];
    for (let i = 0; i < 5; i++) outputs.push(tutor('Con thử nghĩ thêm nhé?'), PASS);
    setGatewayDependencies({ primary: scriptedAnthropic(outputs).provider, fallback: null });
    await say(w, 'con chịu');
    for (let i = 0; i < 3; i++) await say(w, 'gợi ý', { hintRequested: true });
    const r = await say(w, 'gợi ý', { hintRequested: true });
    expect(r).toMatchObject({ state: 'SCAFFOLD', scaffoldLevel: 3 });
    const generated = await appDb().query(`SELECT count(*)::int AS n FROM problems WHERE session_id = $1 AND origin = 'generated'`, [w.sessionId]);
    expect(generated.rows[0].n).toBe(0);
    const alerts = await appDb().query(`SELECT count(*)::int AS n FROM system_alerts WHERE type = 'context_pool_exhausted'`);
    expect(alerts.rows[0].n).toBeGreaterThan(0);
  });

  it('giải xong + giải thích → câu hỏi chuyển giao; con trả lời → DONE, câu trả lời lưu nguyên văn', async () => {
    const w = await homeworkWorld();
    setGatewayDependencies({ primary: scriptedAnthropic([{ hook: 'Đi chợ so giá.' }, PASS, tutor('Đề hỏi gì?'), PASS]).provider, fallback: null });
    await openProblemTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId });
    setGatewayDependencies({
      primary: scriptedAnthropic([
        tutor('Con so bằng cách nào?'),
        PASS,
        tutor('Con tự tìm ra rồi đấy. Lúc nãy chỗ nào làm con nhầm nhỉ?'),
        PASS,
        { question: 'Con nghĩ mình sẽ gặp lại việc so sánh số thập phân ở đâu nhỉ?' },
        PASS,
      ]).provider,
      fallback: null,
    });
    await say(w, '0,45 lớn hơn');
    expect((await say(w, 'à 0,5 lớn hơn')).state).toBe('CONSOLIDATE');
    const transfer = await say(w, 'con tưởng số dài hơn là to hơn');
    expect(transfer.state).toBe('TRANSFER');
    const done = await say(w, 'khi đi chợ so giá tiền');
    expect(done).toMatchObject({ state: 'DONE', done: true });
    const kinds = await appDb().query(`SELECT turn_kind, content FROM turns WHERE session_id = $1 ORDER BY seq`, [w.sessionId]);
    const k = kinds.rows.map((r) => r.turn_kind);
    expect(k[0]).toBe('hook');
    expect(k).toContain('transfer_question');
    expect(kinds.rows.find((r) => r.turn_kind === 'transfer_answer')?.content).toBe('khi đi chợ so giá tiền');
  });
});
