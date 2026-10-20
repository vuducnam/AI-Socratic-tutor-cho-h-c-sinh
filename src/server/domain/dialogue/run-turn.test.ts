import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProblem } from '@/server/dal/problems-dal';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { presolveProblem } from '@/server/domain/presolve/presolve';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { studentWithSession } from '../../../../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { GENERIC_FALLBACK, PAUSE_MESSAGE } from './fallback-question';
import { openProblemTurn, runStudentTurn } from './run-turn';
import { TurnBusyError } from './turn-lock';

// Logic sinh lại/dự phòng/ghi DB của một lượt trên output model dựng sẵn (hồ sơ giả, mục lục giả).

const PLAN: SolutionPlan = {
  steps: [
    { step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'Đổi 0,5 ra phần trăm', expected_result: '50 phần trăm', hint_question: 'Con thử đổi 0,5 ra phần trăm xem?' },
    { step_id: 's2', skill_id: 'FX.DEC.COMPARE', description: 'So sánh 50 và 45 phần trăm', expected_result: '0,5 > 0,45', hint_question: '50 phần trăm và 45 phần trăm, cái nào nhiều hơn?' },
  ],
  final_answer: { value: '0,5 > 0,45', canonical: '>', kind: 'relation', choice_label: null },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: ['FX.DEC.COMPARE.LONGER_IS_BIGGER'],
  sympy_check: { kind: 'relation', expression: '0.5 > 0.45', expected: '>' },
  given_numbers: ['0,45', '0,5'],
};
const tutor = (message: string) => ({ message, question_type: 'evidence', step_addressed: 's1', student_state_guess: 'progressing' });
const PASS = { verdict: 'pass', reasons: [], explanation: '' };
const BLOCK = { verdict: 'block', reasons: ['LEVEL'], explanation: 'khó quá' };

async function world() {
  const w = await studentWithSession('FX5.T1.B4');
  const problemId = await createProblem(w.student, {
    studentId: w.studentId,
    sessionId: w.sessionId,
    origin: 'homework',
    confirmedText: 'Số nào lớn hơn: 0,45 hay 0,5?',
    confirmedByStudent: true,
  });
  setGatewayDependencies({ primary: scriptedAnthropic([PLAN]).provider, fallback: null });
  const presolved = await presolveProblem(
    w.student,
    { studentId: w.studentId, sessionId: w.sessionId, problemId, problemText: 'Số nào lớn hơn: 0,45 hay 0,5?', origin: 'homework', sessionScope: w.scope, catalog: w.catalog },
    { verify: async () => ({ ok: true, computed: '>', detail: 'match' }) },
  );
  if (!presolved.ok) throw new Error('presolve phải đạt');
  const opening = scriptedAnthropic([{ hook: 'Hôm qua Cú đi chợ thấy hai bó rau ghi giá khác nhau đấy.' }, PASS, tutor('Đề hỏi gì nhỉ, con đọc lại cho Cú nghe nhé?'), PASS]);
  setGatewayDependencies({ primary: opening.provider, fallback: null });
  await openProblemTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId });
  return w;
}

const say = (w: Awaited<ReturnType<typeof world>>, text: string, key = crypto.randomUUID(), extra = {}) =>
  runStudentTurn(w.student, { studentId: w.studentId, sessionId: w.sessionId, text, idempotencyKey: key, responseTimeMs: 8000, ...extra });

async function rows(sessionId: string) {
  const turns = await appDb().query('SELECT id, role, content, state_after, scaffold_level FROM turns WHERE session_id = $1 ORDER BY seq', [sessionId]);
  const calls = await appDb().query('SELECT purpose, turn_id FROM llm_calls WHERE session_id = $1 ORDER BY created_at', [sessionId]);
  const verdicts = await appDb().query('SELECT checker, verdict, reasons, turn_id, attempt FROM guard_verdicts WHERE session_id = $1 ORDER BY created_at', [sessionId]);
  return { turns: turns.rows, calls: calls.rows, verdicts: verdicts.rows };
}

beforeEach(resetTestRedis);
afterEach(() => setGatewayDependencies({}));
afterAll(closeTestDatabases);

describe('runStudentTurn', () => {
  it('lượt bình thường: đủ dòng turns, llm_calls (đúng turn_id), guard_verdicts code + llm', async () => {
    const w = await world();
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Con so sánh hai số này bằng cách nào?'), PASS]).provider, fallback: null });
    const r = await say(w, '0,45 lớn hơn ạ');
    expect(r).toMatchObject({ message: 'Con so sánh hai số này bằng cách nào?', state: 'PROBE', source: 'tutor' });
    const { turns, calls, verdicts } = await rows(w.sessionId);
    expect(turns.map((t) => t.role)).toEqual(['tutor', 'tutor', 'student', 'tutor']);
    const turnCalls = calls.filter((c) => c.turn_id === r.tutorTurnId).map((c) => c.purpose);
    expect(turnCalls).toEqual(['tutor', 'guard']);
    expect(verdicts.filter((v) => v.turn_id === r.tutorTurnId).map((v) => `${v.checker}:${v.verdict}`)).toEqual(['code:pass', 'llm:pass']);
  });

  it('tin nhắn lộ đáp án → kiểm tra cứng chặn, Tutor sinh lại', async () => {
    const w = await world();
    setGatewayDependencies({
      primary: scriptedAnthropic([tutor('Đúng là 0,5 lớn hơn 0,45. Con thấy sao?'), tutor('Con thử đổi 0,5 ra phần trăm xem?'), PASS]).provider,
      fallback: null,
    });
    const r = await say(w, 'con không biết so sánh thế nào');
    expect(r.message).toBe('Con thử đổi 0,5 ra phần trăm xem?');
    const { verdicts } = await rows(w.sessionId);
    const mine = verdicts.filter((v) => v.turn_id === r.tutorTurnId);
    expect(mine[0]).toMatchObject({ checker: 'code', verdict: 'block', reasons: ['LEAK'], attempt: 1 });
  });

  it('Guard chặn cả 3 lần viết → câu hỏi dự phòng của bước hiện tại', async () => {
    const w = await world();
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Câu một?'), BLOCK, tutor('Câu hai?'), BLOCK, tutor('Câu ba?'), BLOCK]).provider, fallback: null });
    const r = await say(w, 'con chưa hiểu');
    expect(r).toMatchObject({ source: 'fallback', message: PLAN.steps[0]!.hint_question });
  });

  it('dự phòng cũng không qua kiểm tra cứng → câu chung, lượt system, có cờ', async () => {
    const w = await world();
    const leakyPlanHint = 'Số lớn hơn là 0,5 phải không.';
    PLAN.steps[0]!.hint_question = leakyPlanHint;
    try {
      // Plan đã lưu trong DB từ world() nên phải tạo world sau khi đổi hint.
      const w2 = await world();
      setGatewayDependencies({ primary: scriptedAnthropic([tutor('A?'), BLOCK, tutor('B?'), BLOCK, tutor('C?'), BLOCK]).provider, fallback: null });
      const r = await say(w2, 'hả');
      expect(r).toMatchObject({ source: 'generic', message: GENERIC_FALLBACK });
      const { turns } = await rows(w2.sessionId);
      expect(turns.at(-1)).toMatchObject({ role: 'system', content: GENERIC_FALLBACK });
      const flags = await appDb().query(`SELECT type FROM flags WHERE session_id = $1`, [w2.sessionId]);
      expect(flags.rows.map((f) => f.type)).toContain('tutor_generic_fallback');
    } finally {
      PLAN.steps[0]!.hint_question = 'Con thử đổi 0,5 ra phần trăm xem?';
    }
    expect(w).toBeDefined();
  });

  it('gửi lại cùng idempotency key → trả kết quả cũ, không tạo lượt mới', async () => {
    const w = await world();
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Con nghĩ sao?'), PASS]).provider, fallback: null });
    const first = await say(w, '0,45', 'same-key');
    const before = (await rows(w.sessionId)).turns.length;
    const again = await say(w, '0,45', 'same-key');
    expect(again).toEqual(first);
    expect((await rows(w.sessionId)).turns.length).toBe(before);
  });

  it('hai request đồng thời cùng phiên → chỉ một lượt Tutor', async () => {
    const w = await world();
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Con nghĩ sao?'), PASS, tutor('Còn gì nữa?'), PASS]).provider, fallback: null });
    const results = await Promise.allSettled([say(w, 'một'), say(w, 'hai')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(TurnBusyError);
  });

  it('con có dấu hiệu cần người lớn → PAUSE ngay (không gọi model), cờ severity cao', async () => {
    const w = await world();
    const scripted = scriptedAnthropic([]);
    setGatewayDependencies({ primary: scripted.provider, fallback: null });
    const r = await say(w, 'hôm nay con bị bắt nạt ở trường');
    expect(r).toMatchObject({ paused: true, message: PAUSE_MESSAGE });
    expect(scripted.requests).toHaveLength(0);
    const flags = await appDb().query(`SELECT type, severity FROM flags WHERE session_id = $1`, [w.sessionId]);
    expect(flags.rows).toContainEqual({ type: 'safety_pause', severity: 'high' });
  });

  it('con ra đáp án đúng → CONSOLIDATE (code quyết định, không theo guess của Tutor)', async () => {
    const w = await world();
    // ELICIT luôn sang PROBE trước (SPEC §7), nên cần một lượt đầu.
    setGatewayDependencies({
      primary: scriptedAnthropic([tutor('Con so sánh bằng cách nào?'), PASS, tutor('Con tự tìm ra rồi đấy. Lúc nãy chỗ nào làm con nhầm nhỉ?'), PASS]).provider,
      fallback: null,
    });
    await say(w, '0,45 lớn hơn ạ');
    const r = await say(w, 'à vậy 0,5 lớn hơn');
    expect(r.state).toBe('CONSOLIDATE');
  });

  it('bấm "Gợi ý" → scaffold level tăng', async () => {
    const w = await world();
    setGatewayDependencies({
      primary: scriptedAnthropic([tutor('Con so sánh bằng cách nào?'), PASS, tutor('0,5 là mấy phần mười?'), PASS]).provider,
      fallback: null,
    });
    await say(w, 'con chưa biết');
    const r = await say(w, 'gợi ý', undefined, { hintRequested: true });
    expect(r).toMatchObject({ state: 'SCAFFOLD', scaffoldLevel: 1 });
  });
});
