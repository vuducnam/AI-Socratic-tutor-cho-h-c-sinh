import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { setFrontier } from '@/server/dal/school-progress-dal';
import { seedKeyFacts } from '@/server/dal/seed/seed-key-facts';
import { keyFactsLessonHash, type KeyFactLessonDef } from '@/server/domain/curriculum/key-facts-yaml-schema';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { createAdminWorld, resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeHistoryCurriculum, FH_SUBJECT } from '../../../../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';

// Môn kiến thức (SPEC §5d): Pre-solver chỉ dùng ý chính đã duyệt, code chấm con đã nêu ý nào (cộng dồn qua các lượt),
// kiểm tra cứng chặn Mít nói ra ý con chưa tự nêu, câu hỏi sách không nói tới thì không dạy.

const LESSON = 'FH5.T1.B3';
const F = (n: number) => `${LESSON}.F${n}`;
const QUESTION = 'Chiến dịch Điện Biên Phủ diễn ra từ ngày nào đến ngày nào?';
const PASS = { verdict: 'pass', reasons: [], leak_quotes: [], explanation: '' };
const LEAK_BLOCK = (quote: string) => ({ verdict: 'block', reasons: ['LEAK'], leak_quotes: [quote], explanation: `lộ «${quote}»` });
const tutor = (message: string) => ({ message, short_message: message, question_type: 'clarify', step_addressed: 's1', student_state_guess: 'progressing' });
const PLAN_OUTPUT = {
  not_covered: false,
  not_covered_reason: null,
  question_type: 'fact',
  steps: [
    { step_id: 's1', fact_ids: [F(1)], description: 'Ngày mở màn', expected_result: 'ngày 13 tháng 3', hint_question: 'Chiến dịch mở màn vào ngày nào?' },
    { step_id: 's2', fact_ids: [F(2)], description: 'Ngày kết thúc', expected_result: 'ngày 7 tháng 5', hint_question: 'Còn ngày kết thúc thì sao?' },
  ],
  required_fact_ids: [F(1), F(2)],
  min_required: 2,
  context_fact_ids: [F(3)],
  summary: 'Từ ngày 13 tháng 3 đến ngày 7 tháng 5 năm 1954.',
};

let learn: typeof import('@/server/domain/session/learn-flow');
let turns: typeof import('@/server/domain/dialogue/run-turn');

beforeAll(async () => {
  process.env.CU_SUBJECTS_CONFIG = 'tests/fixtures/subjects-two.yaml';
  await ensureFakeHistoryCurriculum();
  const facts: KeyFactLessonDef['facts'] = [
    { fact_id: F(1), statement: 'Chiến dịch mở màn ngày 13 tháng 3 năm 1954.', kind: 'date', accept: ['ngày 13 tháng 3', '13 3 1954'], pages: '1', locator: 'mục 1' },
    { fact_id: F(2), statement: 'Chiến dịch kết thúc thắng lợi ngày 7 tháng 5 năm 1954.', kind: 'date', accept: ['ngày 7 tháng 5', '7 5 1954'], pages: '1', locator: 'mục 1' },
    { fact_id: F(3), statement: 'Phan Đình Giót lấy thân mình lấp lỗ châu mai.', kind: 'person', accept: ['phan đình giót'], pages: '1', locator: 'Em có biết' },
  ];
  const base = { lesson_id: LESSON, subject: FH_SUBJECT, objectives: [], question_styles: [], opinion_prompts_present: false, facts };
  await seedKeyFacts(mintActor('system', SYSTEM_ACTOR_ID), [
    { ...base, approved: { by: 'fixture-approver@test.local', at: '2026-10-21', content_hash: keyFactsLessonHash(base) } },
  ]);
  learn = await import('@/server/domain/session/learn-flow');
  turns = await import('@/server/domain/dialogue/run-turn');
});
beforeEach(resetTestRedis);
afterEach(() => setGatewayDependencies({}));
afterAll(async () => {
  delete process.env.CU_SUBJECTS_CONFIG;
  await closeTestDatabases();
});

async function historySession() {
  const w = await createAdminWorld();
  await setFrontier(mintActor('parent', w.parentId), { studentId: w.studentId, subject: FH_SUBJECT, lessonId: 'FH5.T1.B4' });
  const actor = mintActor('student', w.studentId);
  const r = await learn.startOrResumeSession(actor, { studentId: w.studentId, subject: FH_SUBJECT });
  if (!r.ok) throw new Error('phải mở được phiên');
  return { ...w, actor, sessionId: r.sessionId };
}

describe('môn kiến thức: Lịch sử và Địa lí', () => {
  it('kế hoạch chỉ từ ý chính đã duyệt; chấm cộng dồn; chặn Mít nói ra ý con chưa nêu', async () => {
    const w = await historySession();
    const presolve = scriptedAnthropic([PLAN_OUTPUT, { hook: 'Nhà bạn có tờ lịch ghi các ngày lễ lớn của đất nước.' }, PASS, tutor('Đề hỏi mấy mốc thời gian?'), PASS]);
    setGatewayDependencies({ primary: presolve.provider, fallback: null });
    const opened = await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: QUESTION });
    expect(opened).toMatchObject({ ok: true });
    // Prompt Pre-solver có ý chính đã duyệt kèm trang, bài được đánh dấu đã học.
    const system = JSON.stringify(presolve.requests[0]!.system);
    expect(system).toContain(F(1));
    expect(system).toContain('đã học');
    // Câu mở nhận các ý chính cần giữ để tránh kể sẵn (ý ngữ cảnh của câu sự kiện thì không).
    const hookSystem = JSON.stringify(presolve.requests[1]!.system);
    expect(hookSystem).toContain('Chiến dịch mở màn ngày 13 tháng 3 năm 1954.');
    expect(hookSystem).not.toContain('Phan Đình Giót lấy thân mình');
    const plans = await appDb().query(`SELECT verified, final_answer->>'kind' AS kind, plan->'knowledge'->>'min_required' AS min FROM solution_plans sp JOIN problems p ON p.id = sp.problem_id WHERE p.session_id = $1`, [w.sessionId]);
    expect(plans.rows).toEqual([{ verified: true, kind: 'key_points', min: '2' }]);

    // Lượt 1: con nêu ngày mở màn. Mít định nói luôn ngày kết thúc → kiểm tra cứng chặn, Mít hỏi lại.
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Đúng, kết thúc ngày 7 tháng 5 đó, bạn thấy sao?'), tutor('Còn ngày kết thúc thì bạn xem lại trang 1 nhé?'), PASS]).provider, fallback: null });
    const first = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Mở màn ngày 13 tháng 3 ạ', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(first.message).toBe('Còn ngày kết thúc thì bạn xem lại trang 1 nhé?');
    expect(['CONSOLIDATE', 'TRANSFER', 'DONE']).not.toContain(first.state);
    const leak = await appDb().query(`SELECT reasons FROM guard_verdicts WHERE turn_id = $1 AND checker = 'code' AND verdict = 'block'`, [first.tutorTurnId]);
    expect(leak.rows.flatMap((r) => r.reasons)).toContain('LEAK');
    const sig = await appDb().query(`SELECT signals->'stated_fact_ids' AS stated FROM turns WHERE id = $1`, [first.tutorTurnId]);
    expect(sig.rows[0].stated).toEqual([F(1)]);

    // Lượt 2: con nêu nốt ngày kết thúc → đủ hai ý bắt buộc → CONSOLIDATE (code quyết định, không phải model).
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Bạn tìm ra hai mốc đó bằng cách nào?'), PASS]).provider, fallback: null });
    const second = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Kết thúc ngày 7 tháng 5', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(second.state).toBe('CONSOLIDATE');

    // Con không chịu giải thích: Mít hỏi "vì sao" tối đa hai lượt rồi sang câu chuyển giao, không hỏi dồn.
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Bạn nhớ ra mốc đó từ đâu?'), PASS]).provider, fallback: null });
    const third = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Biết rồi mà', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(third.state).toBe('CONSOLIDATE');
    const transferQ = 'Bạn nhớ chắc thật đó. Bạn sẽ gặp lại hai mốc này ở đâu, như trên tờ lịch ngày lễ?';
    setGatewayDependencies({ primary: scriptedAnthropic([{ question: transferQ }, PASS]).provider, fallback: null });
    const fourth = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Thì nó vậy', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(fourth.state).toBe('TRANSFER');
    expect(fourth.message).toBe(transferQ);

    // Prompt riêng của môn kiến thức, kể cả Guard và câu chuyển giao (Toán giữ guard/v11, transfer/v4).
    const versions = await appDb().query(`SELECT DISTINCT prompt_version FROM llm_calls WHERE session_id = $1 ORDER BY 1`, [w.sessionId]);
    expect(versions.rows.map((r) => r.prompt_version)).toEqual(['guard_knowledge/v3', 'hook_knowledge/v3', 'presolve_knowledge/v1', 'transfer_knowledge/v1', 'tutor_knowledge/v3']);
  });

  it('Guard báo lộ mà chữ trích không phải chữ của ý chính: code bác và ghi log; trích đúng chữ thì vẫn chặn', async () => {
    const w = await historySession();
    setGatewayDependencies({ primary: scriptedAnthropic([PLAN_OUTPUT, { hook: 'Nhà bạn có tờ lịch ghi các ngày lễ lớn của đất nước.' }, PASS, tutor('Đề hỏi mấy mốc thời gian?'), PASS]).provider, fallback: null });
    await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: QUESTION });

    // "khi nào" chỉ hỏi loại điều cần tìm: không phải lộ bằng chữ → tin được gửi, có dòng code ghi việc bác.
    const asked = 'Bạn mở SGK trang 1, chiến dịch mở màn khi nào?';
    setGatewayDependencies({ primary: scriptedAnthropic([tutor(asked), LEAK_BLOCK('khi nào')]).provider, fallback: null });
    const first = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Mình không nhớ', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(first.message).toBe(asked);
    const rows = await appDb().query(`SELECT checker, verdict, reasons FROM guard_verdicts WHERE turn_id = $1 AND (llm_call_id IS NOT NULL OR 'LEAK_UNGROUNDED' = ANY(reasons)) ORDER BY checker DESC`, [first.tutorTurnId]);
    expect(rows.rows).toEqual([
      { checker: 'llm', verdict: 'block', reasons: ['LEAK'] },
      { checker: 'code', verdict: 'pass', reasons: ['LEAK_UNGROUNDED'] },
    ]);

    // "thắng lợi" là chữ của ý chính con chưa nói → vẫn chặn, Mít viết lại.
    const safe = 'Bạn đọc lại trang 1 xem chiến dịch kết thúc ra sao nhé?';
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Chiến dịch thắng lợi rồi, bạn nhớ ngày nào không?'), LEAK_BLOCK('thắng lợi'), tutor(safe), PASS]).provider, fallback: null });
    const second = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Vẫn không nhớ', idempotencyKey: crypto.randomUUID(), responseTimeMs: 8000 });
    expect(second.message).toBe(safe);
  });

  it('câu hỏi ý kiến chạy chế độ argue: không chấm đúng sai, con nêu lý do thì sang CONSOLIDATE', async () => {
    const w = await historySession();
    const opinion = {
      ...PLAN_OUTPUT,
      question_type: 'opinion',
      steps: [{ step_id: 's1', fact_ids: [F(3)], description: 'Nêu cảm nghĩ kèm lý do', expected_result: 'ý kiến của em', hint_question: 'Việc làm nào của anh làm bạn nhớ nhất?' }],
      required_fact_ids: [],
      min_required: 0,
      context_fact_ids: [F(3)],
    };
    setGatewayDependencies({ primary: scriptedAnthropic([opinion, { hook: 'Ở nhiều thành phố có con đường mang tên các anh hùng.' }, PASS, tutor('Bạn nghĩ gì về anh ấy?'), PASS]).provider, fallback: null });
    expect(await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Em có suy nghĩ gì về anh hùng Phan Đình Giót?' })).toMatchObject({ ok: true });

    // Lượt đầu luôn ELICIT → PROBE (state machine); lập luận có lý do ở PROBE thì sang CONSOLIDATE.
    setGatewayDependencies({ primary: scriptedAnthropic([tutor('Bạn thấy anh ấy thế nào, vì sao?'), PASS]).provider, fallback: null });
    const first = await turns.runStudentTurn(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Anh ấy dũng cảm', idempotencyKey: crypto.randomUUID(), responseTimeMs: 9000 });
    expect(first.state).toBe('PROBE');
    const reply = scriptedAnthropic([tutor('Bạn dẫn đúng chi tiết trong câu chuyện, có bạn lại nghĩ khác thì sao?'), PASS]);
    setGatewayDependencies({ primary: reply.provider, fallback: null });
    const r = await turns.runStudentTurn(w.actor, {
      studentId: w.studentId,
      sessionId: w.sessionId,
      text: 'Anh ấy rất dũng cảm vì bị thương mà vẫn lao lên để đồng đội tiến công',
      idempotencyKey: crypto.randomUUID(),
      responseTimeMs: 9000,
    });
    expect(JSON.stringify(reply.requests[0]!.system)).toContain('mode: argue');
    expect(r.state).toBe('CONSOLIDATE');
  });

  it('Mít ra đề: tình huống không số đã duyệt, đề không lộ ý chính, kế hoạch kiểm đúng ý của tình huống', async () => {
    await appDb().query(
      `INSERT INTO life_contexts (id, skill_id, theme, template, min_grade, max_grade, safety, content_hash, approved_by, approved_at)
       SELECT 'FH.CTX.CALENDAR', 'FH.DEC.READ', 'home', $1::jsonb, 5, 5, '{"adult_required":false,"notes":""}', 'fixture', id, now()
       FROM users WHERE email = 'fixture-approver@test.local' ON CONFLICT DO NOTHING`,
      [JSON.stringify({ kind: 'question', setup: 'Bố treo tờ lịch có ghi các ngày kỉ niệm lớn của đất nước.', real_question: 'Chiến dịch Điện Biên Phủ diễn ra từ ngày nào đến ngày nào?', fact_ids: [F(1), F(2)] })],
    );
    const { startPracticeProblem } = await import('@/server/domain/session/practice-problem');

    // Lần 1: model viết lộ ngày kết thúc trong đề → code loại, hết tình huống → không ra đề.
    const leaky = await historySession();
    setGatewayDependencies({ primary: scriptedAnthropic([{ problem_text: 'Bạn Lan thấy lịch ghi ngày 7 tháng 5. Chiến dịch Điện Biên Phủ diễn ra từ ngày nào đến ngày nào?' }]).provider, fallback: null });
    expect(await startPracticeProblem(leaky.actor, { studentId: leaky.studentId, sessionId: leaky.sessionId })).toMatchObject({ ok: false });

    // Lần 2: đề hợp lệ → Pre-solver kiến thức → Guard (practice_problem) → tin của Mít chính là đề.
    const w = await historySession();
    const text = 'Bạn Lan thấy bố treo tờ lịch ghi các ngày kỉ niệm lớn. Chiến dịch Điện Biên Phủ diễn ra từ ngày nào đến ngày nào?';
    setGatewayDependencies({ primary: scriptedAnthropic([{ problem_text: text }, PLAN_OUTPUT, PASS]).provider, fallback: null });
    const r = await startPracticeProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId });
    expect(r).toMatchObject({ ok: true, turn: { message: text } });
    const p = await appDb().query(`SELECT origin, life_context_id, context_variables->'fact_ids' AS facts FROM problems WHERE session_id = $1`, [w.sessionId]);
    expect(p.rows).toEqual([{ origin: 'generated', life_context_id: 'FH.CTX.CALENDAR', facts: [F(1), F(2)] }]);
  });

  it('sách không nói tới điều con hỏi → không dạy, báo bố mẹ', async () => {
    const w = await historySession();
    setGatewayDependencies({
      primary: scriptedAnthropic([{ ...PLAN_OUTPUT, not_covered: true, not_covered_reason: 'hỏi về một cuộc chiến không có trong sách', steps: [], required_fact_ids: [], min_required: 0, context_fact_ids: [] }]).provider,
      fallback: null,
    });
    const { NOT_COVERED_MESSAGE } = await import('./presolve');
    const r = await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: 'Trận Ba Lô năm nào?' });
    expect(r).toEqual({ ok: false, message: NOT_COVERED_MESSAGE, reason: 'unverified' });
    const flags = await appDb().query(`SELECT type, detail->>'not_covered' AS why FROM flags WHERE session_id = $1`, [w.sessionId]);
    expect(flags.rows).toEqual([{ type: 'presolve_unverified', why: 'hỏi về một cuộc chiến không có trong sách' }]);
  });

  it('model bịa ý chính không có trong danh sách → sinh lại; vẫn bịa thì không dạy', async () => {
    const w = await historySession();
    const fake = { ...PLAN_OUTPUT, required_fact_ids: ['FH5.T1.B3.F99'], steps: [{ ...PLAN_OUTPUT.steps[0]!, fact_ids: ['FH5.T1.B3.F99'] }], min_required: 1 };
    const scripted = scriptedAnthropic([fake, fake, fake]);
    setGatewayDependencies({ primary: scripted.provider, fallback: null });
    const r = await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: w.sessionId, text: QUESTION });
    expect(r).toMatchObject({ ok: false, reason: 'unverified' });
    expect(scripted.requests).toHaveLength(3);
    expect(JSON.stringify(scripted.requests[1]!.messages)).toContain('FH5.T1.B3.F99');
  });
});
