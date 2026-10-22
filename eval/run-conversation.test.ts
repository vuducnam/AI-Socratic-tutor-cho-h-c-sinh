import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { setDefaultVerifier } from '@/server/domain/presolve/presolve';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { resetTestRedis } from '../tests/helpers/auth-test-world';
import { ensureFakeCurriculum, FX_SUBJECT } from '../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../tests/helpers/scripted-llm';
import { closeTestDatabases } from '../tests/helpers/test-database';

// Kiểm harness eval chạy đúng đường ống (mục lục giả, hồ sơ giả, output model dựng sẵn): bản ghi có hook,
// tin nhắn đã gửi được kiểm lại, judge được gọi; và judge báo lộ mà code không bắt → khoá chờ duyệt.

const PLAN: SolutionPlan = {
  steps: [{ step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'So hàng phần mười', expected_result: '5 > 4', hint_question: 'Hàng phần mười là mấy?' }],
  final_answer: { value: '0,5 > 0,45', canonical: '>', kind: 'relation', choice_label: null },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: [],
  sympy_check: { kind: 'relation', expression: '0.5 > 0.45', expected: '>' },
  given_numbers: ['0,45', '0,5'],
};
const tutor = (message: string) => ({ message, short_message: message, question_type: 'evidence', step_addressed: 's1', student_state_guess: 'progressing' });
const PASS = { verdict: 'pass', reasons: [], explanation: '' };
const PROBLEM = { id: 'FX-01', target_lesson_id: 'FX5.T1.B4', kind: 'compare', origin: 'homework' as const, text: 'Số nào lớn hơn: 0,45 hay 0,5?', answer: { display: '0,5', machine: ['>'] }, skill_ids: ['FX.DEC.COMPARE'] };

beforeAll(async () => {
  process.env.EVAL_SUBJECT = FX_SUBJECT;
  await ensureFakeCurriculum();
  setDefaultVerifier(async () => ({ ok: true, computed: '>', detail: 'match' }));
});
beforeEach(resetTestRedis);
afterEach(() => setGatewayDependencies({}));
afterAll(async () => {
  delete process.env.EVAL_SUBJECT;
  setDefaultVerifier(null);
  await closeTestDatabases();
});

describe('runConversation (eval)', () => {
  it('chạy pipeline thật, kiểm lại tin nhắn đã gửi, gọi judge', async () => {
    const { runConversation } = await import('./run-conversation');
    const judge = { leak_turns: [3], tone: 5, out_of_scope_turns: [], secret_promise: false, lectured_beyond_scope: false, misconception_detected: null, real_question: null, notes: '' };
    const scripted = scriptedAnthropic([
      PLAN,
      { hook: 'Ở chợ có hai bó rau giá khác nhau.' },
      PASS,
      tutor('Đề hỏi gì nhỉ?'),
      PASS,
      tutor('Con so sánh bằng cách nào?'),
      PASS,
      judge,
      { summary: [{ text: 'Con trả lời ngay', evidence_turn_ids: [], evidence_session_ids: ['__SESSION__'], quote: null }], student_reasoning_quotes: [], concerns: [] },
    ]);
    setGatewayDependencies({ primary: scripted.provider, evalPrimary: scripted.provider, fallback: null });
    const rec = await runConversation(PROBLEM, 'guesser', 'learned', ['0,45 lớn hơn ạ']);
    expect(rec).toMatchObject({ outcome: 'conversation', hadHook: true, homeworkTextChanged: false, planSkillsOutOfScope: false });
    expect(rec.tutorMessages.map((m) => m.kind)).toEqual(['hook', 'normal', 'normal']);
    expect(rec.tutorMessages.every((m) => m.hardCheckReasons.length === 0)).toBe(true);
    // Judge báo lượt 3 lộ đáp án nhưng code không thấy → chờ chủ dự án xác nhận.
    expect(rec.judgeLeakKeys).toHaveLength(1);
    expect(scripted.remaining()).toBe(0);
    // Nhận định dẫn session không thuộc học sinh bị loại → không còn nhận định hiển thị sai.
    expect(rec.reportClaims).toEqual({ valid: 0, total: 0 });
  });

  it('bài Mít tạo ở mức chưa học → bộ chọn không sinh bài', async () => {
    const { runGeneratedAheadCase } = await import('./run-conversation');
    setGatewayDependencies({ primary: scriptedAnthropic([]).provider, evalPrimary: scriptedAnthropic([]).provider, fallback: null });
    const rec = await runGeneratedAheadCase(PROBLEM);
    expect(rec.refusedCorrectly).toBe(true);
  });
});
