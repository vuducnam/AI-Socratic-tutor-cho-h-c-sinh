import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { listApprovedMisconceptions, listSessionProblemsWithPlans, listSkillNames } from '@/server/dal/problems-dal';
import { getLearningSession, getStudentContext } from '@/server/dal/sessions-dal';
import { listSessionTurns } from '@/server/dal/turns-dal';
import { applyHomeworkExtension, type HomeworkExtension } from '@/server/domain/curriculum/scope';
import { solutionPlanSchema } from '@/server/domain/presolve/plan-schema';
import type { ChatMessage } from '@/server/llm/llm-types';
import { loadPreset } from './preset';
import { initialState, type DialoguePosition, type DialogueState } from './state-machine';
import { describeSkillSource } from './tutor-prompt';

// Đọc mọi thứ một lượt cần (qua DAL): phiên + scope_snapshot, hồ sơ, đề đang làm + plan đã verify,
// lịch sử lượt, trạng thái hiện tại (state_after của lượt Cú gần nhất).

/** Tín hiệu code ghi vào turns.signals của lượt Cú (để lượt sau tính tiếp, bất biến). */
export interface TutorTurnSignals {
  completed_steps: string[];
  made_progress: boolean;
  student_answers: (string | null)[];
  response_times_ms: number[];
  reason?: string;
  /** Lượt con vừa gửi bị code gắn cờ đoán bừa / nản (metric guessing_rate). */
  guessing?: boolean;
  frustrated?: boolean;
  blocked_reasons?: string[];
  source?: string;
}

const parallelOf = (problem: { context_variables: unknown }) =>
  ((problem.context_variables ?? {}) as { parallel_of?: string | null }).parallel_of ?? null;

/**
 * Đề đang làm: đang ở PARALLEL thì là bài tương tự; ngược lại là đề gốc mới nhất (không phải bài tương tự).
 * `forceProblemId`: quay lại đề gốc sau khi xong bài tương tự.
 */
export async function loadTurnContext(actor: Actor, input: { studentId: string; sessionId: string; forceProblemId?: string }) {
  const [session, student, turns, problems] = await Promise.all([
    getLearningSession(actor, input),
    getStudentContext(actor, { studentId: input.studentId }),
    listSessionTurns(actor, input),
    listSessionProblemsWithPlans(actor, input),
  ]);
  const lastTutorOverall = [...turns].reverse().find((t) => t.role !== 'student' && t.state_after);
  const active =
    (input.forceProblemId && problems.find((p) => p.problem.id === input.forceProblemId)) ||
    (lastTutorOverall?.state_after === 'PARALLEL' && problems.find((p) => p.problem.id === lastTutorOverall.problem_id)) ||
    [...problems].reverse().find((p) => !parallelOf(p.problem)) ||
    null;
  const preset = loadPreset(student.preset);
  const plan = active ? solutionPlanSchema.parse(active.plan.plan) : null;
  const extension = (active?.plan.scope_extension ?? null) as HomeworkExtension | null;
  const scope = applyHomeworkExtension(session.scope_snapshot, extension);

  const problemTurns = active ? turns.filter((t) => t.problem_id === active.problem.id) : [];
  const lastTutor = [...problemTurns].reverse().find((t) => t.role !== 'student' && t.state_after);
  const position: DialoguePosition = lastTutor
    ? { state: lastTutor.state_after as DialogueState, scaffoldLevel: lastTutor.scaffold_level ?? 0 }
    : initialState();
  const tutorSignals = problemTurns
    .filter((t) => t.role !== 'student')
    .map((t) => (t.signals ?? {}) as Partial<TutorTurnSignals>);
  const lastSignals = tutorSignals.at(-1) ?? {};

  const [misconceptions, skills] = await Promise.all([
    plan ? listApprovedMisconceptions(plan.skill_ids) : Promise.resolve([]),
    plan ? listSkillNames(plan.skill_ids) : Promise.resolve([]),
  ]);

  const history: ChatMessage[] = problemTurns.map((t) => ({
    role: t.role === 'student' ? 'user' : 'assistant',
    content: t.content,
  }));

  return {
    parallelOf: active ? parallelOf(active.problem) : null,
    session,
    student,
    preset,
    scope,
    active,
    plan,
    position,
    history,
    problemTurns,
    completedSteps: lastSignals.completed_steps ?? [],
    progressMarks: tutorSignals.map((s) => ({ madeProgress: s.made_progress ?? true })),
    answerAttempts: tutorSignals.flatMap((s) =>
      (s.student_answers ?? []).map((a, i) => ({ answer: a, responseTimeMs: s.response_times_ms?.[i] ?? Number.NaN })),
    ),
    recentStudentTexts: problemTurns.filter((t) => t.role === 'student').map((t) => t.content).slice(-3),
    misconceptions: misconceptions.filter((m) => !plan || plan.misconception_ids.includes(m.id)),
    skillSource: describeSkillSource(skills),
  };
}

export type TurnContext = Awaited<ReturnType<typeof loadTurnContext>>;
