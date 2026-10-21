import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { setFrontier } from '@/server/dal/school-progress-dal';
import { seedCurriculum } from '@/server/dal/seed/seed-curriculum';
import { parseCurriculumFile } from '@/server/domain/curriculum/curriculum-yaml-schema';
import { createAdminWorld, resetTestRedis } from '../../../../tests/helpers/auth-test-world';
import { ensureFakeCurriculum, FX_SKILLS, FX_SUBJECT } from '../../../../tests/helpers/fake-curriculum-world';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';

// Mở phiên theo môn (quy tắc cứng 15): chỉ môn bố mẹ đã đặt tiến độ; từ hai môn thì con chọn; chọn môn khác môn
// đang mở thì phiên cũ đóng (switch_subject). Danh sách môn giả: tests/fixtures/subjects-two.yaml.

const HIST = 'fx-hist';
let learn: typeof import('./learn-flow');

beforeAll(async () => {
  process.env.CU_SUBJECTS_CONFIG = 'tests/fixtures/subjects-two.yaml';
  await ensureFakeCurriculum();
  // Môn thứ hai: dùng lại mục lục giả, đổi mã môn và mã bài cho khỏi trùng.
  const text = readFileSync('tests/fixtures/curriculum/fake-grade5.yaml', 'utf8').replace('subject: math', `subject: ${HIST}`).replaceAll('FX5.', 'FH5.');
  const { lessons } = parseCurriculumFile('fake-hist', text, { knownSkillIds: new Set(FX_SKILLS.map((s) => s.id)) });
  await seedCurriculum(mintActor('system', SYSTEM_ACTOR_ID), { lessons, beyondTerms: [] });
  learn = await import('./learn-flow');
});
beforeEach(resetTestRedis);
afterAll(async () => {
  delete process.env.CU_SUBJECTS_CONFIG;
  await closeTestDatabases();
});

async function child(subjects: { subject: string; lessonId: string }[]) {
  const w = await createAdminWorld();
  for (const s of subjects) await setFrontier(mintActor('parent', w.parentId), { studentId: w.studentId, ...s });
  return { ...w, actor: mintActor('student', w.studentId) };
}

describe('mở phiên theo môn', () => {
  it('chỉ một môn có tiến độ → mở thẳng môn đó, kèm tên môn và bàn phím toán', async () => {
    const w = await child([{ subject: HIST, lessonId: 'FH5.T1.B3' }]);
    const r = await learn.startOrResumeSession(w.actor, { studentId: w.studentId });
    expect(r).toMatchObject({ ok: true, subject: { id: HIST, mathKeyboard: false }, subjects: [{ id: HIST }] });
  });

  it('hai môn → con chọn; chọn môn khác môn đang mở thì phiên cũ đóng với lý do switch_subject', async () => {
    const w = await child([
      { subject: FX_SUBJECT, lessonId: 'FX5.T1.B4' },
      { subject: HIST, lessonId: 'FH5.T1.B3' },
    ]);
    const first = await learn.startOrResumeSession(w.actor, { studentId: w.studentId });
    expect(first).toEqual({ ok: false, reason: 'choose_subject', subjects: [expect.objectContaining({ id: FX_SUBJECT }), expect.objectContaining({ id: HIST })] });

    const hist = await learn.startOrResumeSession(w.actor, { studentId: w.studentId, subject: HIST });
    if (!hist.ok) throw new Error('phải mở được môn đã chọn');
    expect(hist.subject.id).toBe(HIST);
    // Tải lại trang (không gửi môn) → tiếp tục đúng phiên đang mở, không bắt chọn lại.
    expect(await learn.startOrResumeSession(w.actor, { studentId: w.studentId })).toMatchObject({ ok: true, sessionId: hist.sessionId });

    const math = await learn.startOrResumeSession(w.actor, { studentId: w.studentId, subject: FX_SUBJECT });
    if (!math.ok) throw new Error('phải mở được môn Toán');
    expect(math.sessionId).not.toBe(hist.sessionId);
    const rows = await appDb().query(`SELECT subject, end_reason, ended_at IS NULL AS open FROM sessions WHERE student_id = $1 ORDER BY started_at`, [w.studentId]);
    expect(rows.rows).toEqual([
      { subject: HIST, end_reason: 'switch_subject', open: false },
      { subject: FX_SUBJECT, end_reason: null, open: true },
    ]);
  });

  it('môn chưa đặt tiến độ → không mở phiên dù con chọn đúng môn', async () => {
    const w = await child([{ subject: FX_SUBJECT, lessonId: 'FX5.T1.B4' }]);
    expect(await learn.startOrResumeSession(w.actor, { studentId: w.studentId, subject: HIST })).toMatchObject({ ok: false, reason: 'progress_missing' });
  });
});
