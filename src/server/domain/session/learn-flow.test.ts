import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mintActor } from '@/server/dal/mint-actor';
import { setFrontier } from '@/server/dal/school-progress-dal';
import { setDefaultVerifier } from '@/server/domain/presolve/presolve';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { setGatewayDependencies } from '@/server/llm/llm-gateway';
import { runCloseIdleSessions } from '@worker/jobs/close-idle-sessions';
import { createAdminWorld, resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeCurriculum, FX_SUBJECT } from '../../../../tests/helpers/fake-curriculum-world';
import { scriptedAnthropic } from '../../../../tests/helpers/scripted-llm';
import { appDb, ownerDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { minutesUsed, startOfVietnamDay } from './usage-limits';

// /learn: mở/tiếp tục phiên, nộp đề gõ tay (giữ nguyên đề) → Pre-solver → hook + ELICIT; hết giờ trong
// ngày thì chặn; phiên bỏ dở quá 30 phút được worker đóng (timeout) và có job báo cáo.

const PLAN: SolutionPlan = {
  steps: [{ step_id: 's1', skill_id: 'FX.DEC.COMPARE', description: 'So hàng phần mười', expected_result: '5 > 4', hint_question: 'Hàng phần mười là mấy?' }],
  final_answer: { value: '0,5 > 0,45', canonical: '>', kind: 'relation', choice_label: null },
  skill_ids: ['FX.DEC.COMPARE'],
  misconception_ids: [],
  sympy_check: { kind: 'relation', expression: '0.5 > 0.45', expected: '>' },
  given_numbers: ['0,45', '0,5'],
};
const PASS = { verdict: 'pass', reasons: [], explanation: '' };

let learn: typeof import('./learn-flow');

beforeAll(async () => {
  await ensureFakeCurriculum();
  setDefaultVerifier(async () => ({ ok: true, computed: '>', detail: 'match' }));
  learn = await import('./learn-flow');
});
beforeEach(resetTestRedis);
afterEach(() => setGatewayDependencies({}));
afterAll(async () => {
  setDefaultVerifier(null);
  await closeTestDatabases();
});

async function student(frontier = 'FX5.T1.B4') {
  const w = await createAdminWorld();
  // Mục lục giả là môn fx-math nên test mở phiên trực tiếp theo môn đó (startOrResumeSession dùng môn math).
  await setFrontier(mintActor('parent', w.parentId), { studentId: w.studentId, subject: FX_SUBJECT, lessonId: frontier });
  return { ...w, actor: mintActor('student', w.studentId) };
}

describe('learn flow', () => {
  it('chưa có tiến độ môn Toán → báo bố mẹ cần đặt tiến độ', async () => {
    const w = await createAdminWorld();
    const r = await learn.startOrResumeSession(mintActor('student', w.studentId), { studentId: w.studentId });
    expect(r).toMatchObject({ ok: false, reason: 'progress_missing' });
  });

  it('nộp đề gõ tay: đề giữ nguyên, có hook rồi câu ELICIT', async () => {
    const w = await student();
    const { openLearningSession } = await import('./open-session');
    const opened = await openLearningSession(w.actor, { studentId: w.studentId, subject: FX_SUBJECT });
    if (!opened.ok) throw new Error('phải mở được');
    setGatewayDependencies({
      primary: scriptedAnthropic([PLAN, { hook: 'Ở chợ có hai bó rau.' }, PASS, { message: 'Đề hỏi gì nhỉ?', question_type: 'clarify', step_addressed: 's1', student_state_guess: 'progressing' }, PASS]).provider,
      fallback: null,
    });
    const r = await learn.submitTypedProblem(w.actor, { studentId: w.studentId, sessionId: opened.sessionId, text: 'Số nào lớn hơn: 0,45 hay 0,5?' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.turn.before?.[0]?.kind).toBe('hook');
    expect(r.turn.message).toBe('Đề hỏi gì nhỉ?');
    const p = await appDb().query('SELECT confirmed_text, confirmed_by_student FROM problems WHERE session_id = $1', [opened.sessionId]);
    expect(p.rows).toEqual([{ confirmed_text: 'Số nào lớn hơn: 0,45 hay 0,5?', confirmed_by_student: true }]);
  });

  it('phiên bỏ dở quá 30 phút → worker đóng với end_reason timeout', async () => {
    const w = await student();
    const { openLearningSession } = await import('./open-session');
    const opened = await openLearningSession(w.actor, { studentId: w.studentId, subject: FX_SUBJECT });
    if (!opened.ok) throw new Error('phải mở được');
    await ownerDb().query(`UPDATE sessions SET last_activity_at = now() - interval '31 minutes' WHERE id = $1`, [opened.sessionId]);
    const r = await runCloseIdleSessions();
    expect(r.closed).toBeGreaterThan(0);
    const s = await appDb().query('SELECT ended_at, end_reason FROM sessions WHERE id = $1', [opened.sessionId]);
    expect(s.rows[0].end_reason).toBe('timeout');
    expect(s.rows[0].ended_at).not.toBeNull();
    const { redis } = await import('@/server/auth/redis-client');
    expect(await redis().keys('bull:cu-reports:report-*')).toContain(`bull:cu-reports:report-${opened.sessionId}`);
  });

  it('tính phút đã học trong ngày (giờ Việt Nam)', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    const day = startOfVietnamDay(now);
    expect(day.toISOString()).toBe('2026-10-18T17:00:00.000Z');
    expect(
      minutesUsed(
        [
          { started_at: new Date('2026-10-19T09:00:00Z'), last_activity_at: new Date('2026-10-19T09:20:00Z'), ended_at: null },
          { started_at: new Date('2026-10-18T16:50:00Z'), last_activity_at: new Date('2026-10-18T17:10:00Z'), ended_at: null },
        ],
        now,
      ),
    ).toBe(30);
  });
});
