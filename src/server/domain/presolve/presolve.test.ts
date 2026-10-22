import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createProblem } from '@/server/dal/problems-dal';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { studentWithSession } from '../../../../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import type { SolutionPlan } from './plan-schema';
import { MAX_REGENERATIONS, presolveProblem } from './presolve';

// Logic code của Pre-solver (kiểm phạm vi, đếm sinh lại, gắn cờ) trên output model dựng sẵn với hồ sơ giả.
// Phần gọi LLM thật nằm ở eval/presolve-acceptance.ts.

afterEach(() => setGatewayDependencies({}));
afterAll(closeTestDatabases);

const comparePlan = (overrides: Partial<SolutionPlan> = {}): SolutionPlan => ({
  steps: [
    { step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'So sánh phần nguyên', expected_result: 'bằng nhau', hint_question: 'Phần nguyên hai số thế nào?' },
    { step_id: 's2', skill_id: 'FX.DEC.COMPARE', description: 'So sánh hàng phần mười', expected_result: '5 > 4', hint_question: 'Hàng phần mười của hai số là mấy?' },
  ],
  final_answer: { value: '0,5 > 0,45', canonical: '>', kind: 'relation', choice_label: null },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: ['FX.DEC.COMPARE.LONGER_IS_BIGGER'],
  sympy_check: { kind: 'relation', expression: '0.5 > 0.45', expected: '>' },
  given_numbers: ['0,45', '0,5'],
  ...overrides,
});

type Verify = NonNullable<Parameters<typeof presolveProblem>[2]>['verify'];
const ok: Verify = async () => ({ ok: true, computed: '>', detail: 'match' });
const fail: Verify = async () => ({ ok: false, computed: '<', detail: 'mismatch' });

async function setup(frontier: string, origin: 'homework' | 'generated' = 'homework') {
  const w = await studentWithSession(frontier);
  const problemId = await createProblem(w.student, {
    studentId: w.studentId,
    sessionId: w.sessionId,
    origin,
    confirmedText: 'So sánh 0,45 và 0,5.',
    confirmedByStudent: true,
    lifeContextId: origin === 'generated' ? 'FX.CTX.SHOP' : null,
  });
  return { ...w, problemId };
}

const run = (w: Awaited<ReturnType<typeof setup>>, origin: 'homework' | 'generated', verify = ok) =>
  presolveProblem(
    w.student,
    { studentId: w.studentId, sessionId: w.sessionId, problemId: w.problemId, problemText: 'So sánh 0,45 và 0,5.', origin, sessionScope: w.scope, catalog: w.catalog },
    { verify },
  );

async function plans(problemId: string) {
  const { rows } = await appDb().query('SELECT verified, scope_extension, llm_call_id FROM solution_plans WHERE problem_id = $1 ORDER BY created_at', [problemId]);
  return rows;
}

describe('presolveProblem', () => {
  it('trong phạm vi, verify đạt ngay → plan đã verify, có llm_call_id', async () => {
    const w = await setup('FX5.T1.B4');
    setGatewayDependencies({ primary: scriptedAnthropic([comparePlan()]).provider, fallback: null });
    const r = await run(w, 'homework');
    expect(r).toMatchObject({ ok: true, attempts: 1, scopeExtension: null, progressSuggestionId: null });
    const rows = await plans(w.problemId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verified: true });
    expect(rows[0].llm_call_id).toBeTruthy();
  });

  it('planMemo (eval): đề cùng đầu vào lần hai không gọi model, vẫn verify và ghi plan', async () => {
    const memo = new Map<string, SolutionPlan>();
    const a = await setup('FX5.T1.B4');
    const b = await setup('FX5.T1.B4');
    // Chỉ có một output model: lần thứ hai phải lấy từ memo, gọi model lần nữa sẽ hết output giả.
    setGatewayDependencies({ primary: scriptedAnthropic([comparePlan()]).provider, fallback: null });
    const input = (w: typeof a) => ({ studentId: w.studentId, sessionId: w.sessionId, problemId: w.problemId, problemText: 'So sánh 0,45 và 0,5.', origin: 'homework' as const, sessionScope: w.scope, catalog: w.catalog });
    let verifyCalls = 0;
    const countingOk: Verify = async (req) => {
      verifyCalls += 1;
      return ok!(req);
    };
    expect(await presolveProblem(a.student, input(a), { verify: countingOk, planMemo: memo })).toMatchObject({ ok: true });
    expect(await presolveProblem(b.student, input(b), { verify: countingOk, planMemo: memo })).toMatchObject({ ok: true });
    expect(verifyCalls).toBe(2);
    const rows = await plans(b.problemId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verified: true, llm_call_id: null });
  });

  it('verify sai → sinh lại; vẫn sai sau 2 lần sinh lại → không dạy, cờ presolve_unverified', async () => {
    const w = await setup('FX5.T1.B4');
    setGatewayDependencies({ primary: scriptedAnthropic([comparePlan(), comparePlan(), comparePlan()]).provider, fallback: null });
    const r = await run(w, 'homework', fail);
    expect(r).toMatchObject({ ok: false, reason: 'unverified', attempts: MAX_REGENERATIONS + 1 });
    expect((await plans(w.problemId)).every((p) => p.verified === false)).toBe(true);
    const flags = await appDb().query(`SELECT type FROM flags WHERE student_id = $1`, [w.studentId]);
    expect(flags.rows.map((f) => f.type)).toContain('presolve_unverified');
  });

  it('plan không nhất quán (canonical ≠ expected) → không gọi verify, sinh lại', async () => {
    const w = await setup('FX5.T1.B4');
    const bad = comparePlan({ final_answer: { value: '0,5', canonical: '<', kind: 'relation', choice_label: null } });
    setGatewayDependencies({ primary: scriptedAnthropic([bad, comparePlan()]).provider, fallback: null });
    const r = await run(w, 'homework');
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it('(a) bài về nhà cùng lớp vượt tiến độ → được dạy, có scope_extension và đúng một gợi ý tiến độ, frontier không đổi', async () => {
    const w = await setup('FX5.T1.B2');
    setGatewayDependencies({ primary: scriptedAnthropic([comparePlan(), comparePlan()]).provider, fallback: null });
    const r = await run(w, 'homework');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scopeExtension?.lessonId).toBe('FX5.T1.B4');
    expect(r.scope.allowedSkillIds).toContain('FX.DEC.COMPARE');
    const verifiedPlan = (await plans(w.problemId)).find((p) => p.verified);
    expect(verifiedPlan?.scope_extension).toMatchObject({ lessonId: 'FX5.T1.B4' });
    const s = await appDb().query(`SELECT lesson_id, status FROM progress_suggestions WHERE student_id = $1`, [w.studentId]);
    expect(s.rows).toEqual([{ lesson_id: 'FX5.T1.B4', status: 'pending' }]);
    const p = await appDb().query(`SELECT frontier_lesson_id FROM school_progress WHERE student_id = $1`, [w.studentId]);
    expect(p.rows[0].frontier_lesson_id).toBe('FX5.T1.B2');
  });

  it('(b) cùng đề nhưng origin generated → từ chối, cờ out_of_scope_problem', async () => {
    const w = await setup('FX5.T1.B2', 'generated');
    setGatewayDependencies({ primary: scriptedAnthropic([comparePlan(), comparePlan(), comparePlan()]).provider, fallback: null });
    const r = await run(w, 'generated');
    expect(r).toMatchObject({ ok: false, reason: 'out_of_scope' });
    const flags = await appDb().query(`SELECT type FROM flags WHERE student_id = $1`, [w.studentId]);
    expect(flags.rows.map((f) => f.type)).toContain('out_of_scope_problem');
    expect((await plans(w.problemId)).some((p) => p.verified)).toBe(false);
  });

  it('(c) đề lớp trên (skill lớp 6) → từ chối, cờ', async () => {
    const w = await setup('FX5.T2.B10');
    const negative = comparePlan({
      skill_ids: ['FX.NEG'],
      steps: [{ step_id: 's1', skill_id: 'FX.NEG', description: 'x', expected_result: 'x', hint_question: 'x?' }],
    });
    setGatewayDependencies({ primary: scriptedAnthropic([negative, negative, negative]).provider, fallback: null });
    expect(await run(w, 'homework')).toMatchObject({ ok: false, reason: 'out_of_scope' });
  });

  it('prompt gửi đi có phạm vi đã học và chỉ misconception đã duyệt', async () => {
    const w = await setup('FX5.T1.B4');
    const scripted = scriptedAnthropic([comparePlan()]);
    setGatewayDependencies({ primary: scripted.provider, fallback: null });
    await run(w, 'homework');
    const system = JSON.stringify(scripted.requests[0]!.system);
    expect(system).toContain('Đã học tới: Toán 5 (fixture), Tập 1, So sánh số thập phân (fixture)');
    expect(system).toContain('FX.DEC.COMPARE.LONGER_IS_BIGGER');
    expect(system).not.toContain('{curriculum_scope}');
  });
});
