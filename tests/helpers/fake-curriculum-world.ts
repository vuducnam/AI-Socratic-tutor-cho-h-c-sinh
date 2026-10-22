import { readFileSync } from 'node:fs';
import { SYSTEM_ACTOR_ID } from '@/server/dal/actor';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { mintActor } from '@/server/dal/mint-actor';
import { setFrontier } from '@/server/dal/school-progress-dal';
import { seedCurriculum } from '@/server/dal/seed/seed-curriculum';
import { parseCurriculumFile } from '@/server/domain/curriculum/curriculum-yaml-schema';
import { openLearningSession } from '@/server/domain/session/open-session';
import { createAdminWorld } from './auth-test-world';
import { appDb } from './test-database';

// Thế giới test với mục lục GIẢ (môn fx-math, tests/fixtures/curriculum/fake-grade5.yaml) và hồ sơ giả.
export const FX_SUBJECT = 'fx-math';
export const FX_SKILLS: { id: string; grade: number }[] = [
  { id: 'FX.NAT.ADD', grade: 5 },
  { id: 'FX.DEC.READ', grade: 5 },
  { id: 'FX.DEC.COMPARE', grade: 5 },
  { id: 'FX.DEC.ADD', grade: 5 },
  { id: 'FX.PCT', grade: 5 },
  { id: 'FX.NEG', grade: 6 },
];

let seeded = false;
export async function ensureFakeCurriculum(): Promise<void> {
  if (seeded) return;
  for (const s of FX_SKILLS) {
    await appDb().query(
      `INSERT INTO skills (skill_id, subject, grade_introduced, name, source) VALUES ($1, $2, $3, $1,
       '{"official_url":"https://taphuan.nxbgd.vn/fixture","lesson":"fixture"}') ON CONFLICT DO NOTHING`,
      [s.id, FX_SUBJECT, s.grade],
    );
  }
  await appDb().query(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Người duyệt fixture', 'fixture-approver@test.local', 'x')
     ON CONFLICT (email) DO NOTHING`,
  );
  await appDb().query(
    `INSERT INTO misconceptions (id, skill_id, description, probe, approved_by, approved_at)
     SELECT 'FX.DEC.COMPARE.LONGER_IS_BIGGER', 'FX.DEC.COMPARE', 'Nghĩ số dài hơn thì lớn hơn', 'Cắt bánh 10 phần và 100 phần?', id, now()
     FROM users WHERE email = 'fixture-approver@test.local' ON CONFLICT DO NOTHING`,
  );
  await appDb().query(
    `INSERT INTO life_contexts (id, skill_id, theme, template, min_grade, max_grade, safety, content_hash)
     VALUES ('FX.CTX.SHOP', 'FX.DEC.COMPARE', 'market', '{"setup":"x","real_question":"y","variables":{}}', 5, 5,
             '{"adult_required":false,"notes":""}', 'fixture') ON CONFLICT DO NOTHING`,
  );
  const text = readFileSync('tests/fixtures/curriculum/fake-grade5.yaml', 'utf8').replace('subject: math', `subject: ${FX_SUBJECT}`);
  const { lessons } = parseCurriculumFile('fake', text, { knownSkillIds: new Set(FX_SKILLS.map((s) => s.id)) });
  await seedCurriculum(mintActor('system', SYSTEM_ACTOR_ID), { lessons, beyondTerms: [] });
  seeded = true;
}

/** Học sinh giả có tiến độ ở `frontierLessonId` và một phiên đang mở. */
export async function studentWithSession(frontierLessonId: string) {
  await ensureFakeCurriculum();
  const w = await createAdminWorld();
  await setFrontier(mintActor('parent', w.parentId), { studentId: w.studentId, subject: FX_SUBJECT, lessonId: frontierLessonId });
  const student = mintActor('student', w.studentId);
  const opened = await openLearningSession(student, { studentId: w.studentId, subject: FX_SUBJECT });
  if (!opened.ok) throw new Error('không mở được phiên');
  const catalog = await loadScopeCatalog(FX_SUBJECT, 5);
  return { ...w, student, sessionId: opened.sessionId, scope: opened.scope, catalog };
}
