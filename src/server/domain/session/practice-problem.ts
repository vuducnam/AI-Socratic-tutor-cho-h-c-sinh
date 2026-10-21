import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { listContextsForSkills } from '@/server/dal/life-contexts-dal';
import { getLearningSession, getStudentContext } from '@/server/dal/sessions-dal';
import { openPracticeProblemTurn } from '@/server/domain/dialogue/run-turn';
import { generateSituationalProblem } from '@/server/domain/life-context/generate-situational-problem';
import { pickPracticeSkill } from '@/server/domain/life-context/pick-practice-skill';
import { assertTimeLeft, type ProblemStartResult } from './learn-flow';

// "Mít ra đề cho bạn" (con bấm ở màn nhập đề): Mít tạo một đề tình huống đời thật từ thư viện đã duyệt, cho skill
// con đã học (ưu tiên bài vừa học). Đi đúng pipeline của mọi đề Mít tạo: điền số bằng code → contextualize →
// Pre-solver + sympy → kiểm tra cứng + Guard (quy tắc cứng 13, 15). Không có đề phù hợp → câu thân thiện.

export const PRACTICE_UNAVAILABLE = 'Mít chưa nghĩ ra đề hợp với bài bạn đang học. Bạn gửi đề bài của bạn nhé.';

export async function startPracticeProblem(
  actor: Actor,
  input: { studentId: string; sessionId: string; evalMode?: 'live' | 'eval' },
): Promise<ProblemStartResult> {
  const limit = await assertTimeLeft(actor, input.studentId, input.sessionId);
  if (limit) return { ok: false, message: limit, reason: 'time_limit' };
  const session = await getLearningSession(actor, { studentId: input.studentId, sessionId: input.sessionId });
  if (session.ended_at) return { ok: false, message: 'Phiên học đã xong, bạn mở phiên mới nhé.', reason: 'session_closed' };
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const scope = session.scope_snapshot;
  const catalog = await loadScopeCatalog(session.subject, student.grade);

  const contexts = await listContextsForSkills(scope.allowedSkillIds);
  const skillsWithContexts = new Set(
    contexts.filter((c) => c.approved_by && c.min_grade <= student.grade && student.grade <= c.max_grade).map((c) => c.skill_id),
  );
  const skill = pickPracticeSkill({ scope, lessons: catalog.lessons, skillsWithContexts });
  if (!skill) return { ok: false, message: PRACTICE_UNAVAILABLE, reason: 'no_context' };

  const generated = await generateSituationalProblem(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    student,
    scope,
    catalog,
    targetSkillIds: [skill],
    evalMode: input.evalMode,
  });
  if (!generated.ok) return { ok: false, message: PRACTICE_UNAVAILABLE, reason: generated.reason };

  const turn = await openPracticeProblemTurn(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    problemId: generated.problemId,
    problemText: generated.problemText,
    visual: generated.visual,
    evalMode: input.evalMode,
  });
  if (!turn) return { ok: false, message: PRACTICE_UNAVAILABLE, reason: 'blocked' };
  return { ok: true, turn };
}
