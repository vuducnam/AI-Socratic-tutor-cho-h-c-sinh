import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTermMatches } from '@/lib/term-pattern-matcher';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { seedCurriculum } from '@/server/dal/seed/seed-curriculum';
import { allowPreview, listProgressEvents, setFrontier } from '@/server/dal/school-progress-dal';
import { getLearningSession } from '@/server/dal/sessions-dal';
import { parseCurriculumFile } from '@/server/domain/curriculum/curriculum-yaml-schema';
import { createAdminWorld } from '../../../../tests/helpers/auth-test-world';
import { appDb, closeTestDatabases } from '../../../../tests/helpers/test-database';
import { openLearningSession, PROGRESS_MISSING_MESSAGE } from './open-session';

// SPEC §15.5b: học sinh chưa có tiến độ không mở được phiên; tiến độ trước chủ đề số thập phân →
// phạm vi không có skill số thập phân và thuật ngữ của chủ đề bị chặn. Dùng mục lục giả (môn fx-math).

const SUBJECT = 'fx-math';
const system = mintActor('system', SYSTEM_ACTOR_ID);

beforeAll(async () => {
  const text = readFileSync('tests/fixtures/curriculum/fake-grade5.yaml', 'utf8').replace('subject: math', `subject: ${SUBJECT}`);
  const skillIds = ['FX.NAT.ADD', 'FX.DEC.READ', 'FX.DEC.COMPARE', 'FX.DEC.ADD', 'FX.PCT'];
  for (const id of skillIds) {
    await appDb().query(
      `INSERT INTO skills (skill_id, subject, grade_introduced, name, source) VALUES ($1, $2, 5, $1,
       '{"official_url":"https://taphuan.nxbgd.vn/fixture","lesson":"fixture"}') ON CONFLICT DO NOTHING`,
      [id, SUBJECT],
    );
  }
  const { lessons } = parseCurriculumFile('fake', text, { knownSkillIds: new Set(skillIds) });
  await seedCurriculum(system, { lessons, beyondTerms: [] });
});
afterAll(closeTestDatabases);

describe('mở phiên học', () => {
  it('chưa đặt tiến độ → không mở được phiên, có cờ progress_missing', async () => {
    const w = await createAdminWorld();
    const student = mintActor('student', w.studentId);
    const result = await openLearningSession(student, { studentId: w.studentId, subject: SUBJECT });
    expect(result).toEqual({ ok: false, reason: 'progress_missing', message: PROGRESS_MISSING_MESSAGE });
    const flags = await appDb().query(`SELECT type FROM flags WHERE student_id = $1`, [w.studentId]);
    expect(flags.rows.map((r) => r.type)).toContain('progress_missing');
    const sessions = await appDb().query(`SELECT count(*)::int AS n FROM sessions WHERE student_id = $1`, [w.studentId]);
    expect(sessions.rows[0].n).toBe(0);
  });

  it('tiến độ trước chủ đề số thập phân: snapshot không có skill số thập phân, thuật ngữ bị chặn', async () => {
    const w = await createAdminWorld();
    const parent = mintActor('parent', w.parentId);
    await setFrontier(parent, { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T1.B2' });
    const student = mintActor('student', w.studentId);
    const result = await openLearningSession(student, { studentId: w.studentId, subject: SUBJECT });
    if (!result.ok) throw new Error('phải mở được phiên');
    const session = await getLearningSession(student, { studentId: w.studentId, sessionId: result.sessionId });
    expect(session.scope_snapshot.allowedSkillIds.some((s) => s.startsWith('FX.DEC'))).toBe(false);
    expect(findTermMatches('So sánh hai số thập phân nhé?', session.scope_snapshot.forbiddenTerms)).not.toHaveLength(0);
    expect(session.scope_snapshot.scopeHash).toBe(result.scope.scopeHash);
  });

  it('đổi tiến độ giữa chừng không đổi snapshot của phiên đang mở; mọi thay đổi ghi event', async () => {
    const w = await createAdminWorld();
    const parent = mintActor('parent', w.parentId);
    const student = mintActor('student', w.studentId);
    await setFrontier(parent, { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T1.B3' });
    const opened = await openLearningSession(student, { studentId: w.studentId, subject: SUBJECT });
    if (!opened.ok) throw new Error('phải mở được phiên');
    await setFrontier(parent, { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T1.B6' });
    await allowPreview(parent, { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T2.B9' });
    const session = await getLearningSession(student, { studentId: w.studentId, sessionId: opened.sessionId });
    expect(session.scope_snapshot.frontierLesson?.lessonId).toBe('FX5.T1.B3');
    const events = await listProgressEvents(parent, { studentId: w.studentId });
    expect(events.map((e) => e.action)).toEqual(['allow_preview', 'set_frontier', 'set_frontier']);
    expect(events.every((e) => e.actor_id === w.parentId && e.via === 'parent')).toBe(true);
  });

  it('học sinh không đổi được tiến độ; phụ huynh khác không đổi được', async () => {
    const w = await createAdminWorld();
    const other = await createAdminWorld();
    await expect(
      setFrontier(mintActor('student', w.studentId), { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T1.B1' }),
    ).rejects.toThrow(/phụ huynh/);
    await expect(
      setFrontier(mintActor('parent', other.parentId), { studentId: w.studentId, subject: SUBJECT, lessonId: 'FX5.T1.B1' }),
    ).rejects.toThrow();
  });

  it('bài không thuộc mục lục của lớp con → từ chối', async () => {
    const w = await createAdminWorld();
    await expect(
      setFrontier(mintActor('parent', w.parentId), { studentId: w.studentId, subject: SUBJECT, lessonId: `NOPE.${randomUUID().slice(0, 4)}.B1` }),
    ).rejects.toThrow(/mục lục/);
  });
});
