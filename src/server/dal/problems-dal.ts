import 'server-only';
import type { Actor } from './actor';
import { AuthorizationError, assertStudentAccess } from './actor-authorization';
import type { AuthorizationFixture } from './authorization-fixtures';
import { prisma } from './client';

// Đề bài và solution_plans. Bài về nhà giữ nguyên đề (confirmed_text, SPEC §5b.2).

const logFor = (actor: Actor) => actor.type !== 'student';

async function assertProblemOfStudent(problemId: string, studentId: string) {
  const p = await prisma.problem.findUnique({ where: { id: problemId }, select: { student_id: true } });
  if (!p || p.student_id !== studentId) throw new AuthorizationError('Không có đề này');
}

export async function createProblem(
  actor: Actor,
  input: {
    studentId: string;
    sessionId: string;
    origin: 'homework' | 'generated' | 'mission';
    extractedText?: string | null;
    confirmedText?: string | null;
    confirmedByStudent?: boolean;
    imageUri?: string | null;
    lifeContextId?: string | null;
    contextVariables?: Record<string, unknown> | null;
  },
): Promise<string> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'problems', log: logFor(actor) });
  const session = await prisma.session.findUnique({ where: { id: input.sessionId }, select: { student_id: true } });
  if (session?.student_id !== input.studentId) throw new AuthorizationError('Phiên không thuộc học sinh');
  const p = await prisma.problem.create({
    data: {
      session_id: input.sessionId,
      student_id: input.studentId,
      origin: input.origin,
      extracted_text: input.extractedText ?? null,
      confirmed_text: input.confirmedText ?? null,
      confirmed_by_student: input.confirmedByStudent ?? false,
      image_uri: input.imageUri ?? null,
      life_context_id: input.lifeContextId ?? null,
      context_variables: (input.contextVariables ?? undefined) as object | undefined,
    },
    select: { id: true },
  });
  return p.id;
}

/** Con xác nhận đề (sau OCR hoặc gõ tay): từ đây đề không đổi. */
export async function confirmProblemText(actor: Actor, input: { studentId: string; problemId: string; confirmedText: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'problems', log: logFor(actor) });
  await assertProblemOfStudent(input.problemId, input.studentId);
  const r = await prisma.problem.updateMany({
    where: { id: input.problemId, confirmed_by_student: false },
    data: { confirmed_text: input.confirmedText, confirmed_by_student: true },
  });
  if (r.count === 0) throw new Error('Đề đã được xác nhận, không sửa được');
}

export async function setProblemSkills(actor: Actor, input: { studentId: string; problemId: string; skillIds: string[] }) {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'problems', log: logFor(actor) });
  await assertProblemOfStudent(input.problemId, input.studentId);
  await prisma.problem.update({ where: { id: input.problemId }, data: { skill_ids: input.skillIds } });
}

export async function getProblem(actor: Actor, input: { studentId: string; problemId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'problems', log: logFor(actor) });
  const p = await prisma.problem.findUnique({ where: { id: input.problemId } });
  if (!p || p.student_id !== input.studentId) throw new AuthorizationError('Không có đề này');
  return p;
}

export async function appendSolutionPlan(
  actor: Actor,
  input: {
    studentId: string;
    problemId: string;
    plan: unknown;
    finalAnswer: unknown;
    scopeExtension: unknown;
    verified: boolean;
    verifierOutput: unknown;
    llmCallId: string | null;
  },
): Promise<string> {
  await assertStudentAccess(actor, input.studentId, { action: 'write', resource: 'solution_plans', log: logFor(actor) });
  await assertProblemOfStudent(input.problemId, input.studentId);
  const row = await prisma.solutionPlan.create({
    data: {
      problem_id: input.problemId,
      plan: (input.plan ?? {}) as object,
      final_answer: (input.finalAnswer ?? {}) as object,
      scope_extension: (input.scopeExtension ?? undefined) as object | undefined,
      verified: input.verified,
      verifier_output: (input.verifierOutput ?? undefined) as object | undefined,
      llm_call_id: input.llmCallId,
    },
    select: { id: true },
  });
  return row.id;
}

/** Plan dùng để dạy: chỉ plan đã verify, mới nhất (không bao giờ dạy trên plan chưa verify). */
export async function getTeachingPlan(actor: Actor, input: { studentId: string; problemId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'solution_plans', log: logFor(actor) });
  await assertProblemOfStudent(input.problemId, input.studentId);
  return prisma.solutionPlan.findFirst({
    where: { problem_id: input.problemId, verified: true },
    orderBy: { created_at: 'desc' },
  });
}

/** Đề đang làm của phiên: đề mới nhất đã có plan verify (kèm plan dùng để dạy). */
export async function getActiveSessionProblem(actor: Actor, input: { studentId: string; sessionId: string }) {
  await assertStudentAccess(actor, input.studentId, { action: 'read', resource: 'problems', log: logFor(actor) });
  const problem = await prisma.problem.findFirst({
    where: { session_id: input.sessionId, student_id: input.studentId, solution_plans: { some: { verified: true } } },
    orderBy: { created_at: 'desc' },
    include: { solution_plans: { where: { verified: true }, orderBy: { created_at: 'desc' }, take: 1 } },
  });
  if (!problem) return null;
  return { problem, plan: problem.solution_plans[0]! };
}

/** Misconception đã duyệt của các skill (danh mục chung, không phải dữ liệu học sinh). */
export async function listApprovedMisconceptions(skillIds: string[]) {
  return prisma.misconception.findMany({
    where: { skill_id: { in: skillIds }, approved_by: { not: null } },
    select: { id: true, skill_id: true, description: true, probe: true },
    orderBy: { id: 'asc' },
  });
}

export async function listSkillNames(skillIds: string[]) {
  return prisma.skill.findMany({ where: { skill_id: { in: skillIds } }, select: { skill_id: true, name: true, source: true } });
}

const FAKE = '00000000-0000-0000-0000-000000000001';
export const authorizationFixtures: Record<string, AuthorizationFixture> = {
  createProblem: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => createProblem(a, { studentId: c.studentId, sessionId: c.sessionId, origin: 'homework', confirmedText: 'x' }),
  },
  confirmProblemText: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => confirmProblemText(a, { studentId: c.studentId, problemId: FAKE, confirmedText: 'x' }),
  },
  setProblemSkills: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => setProblemSkills(a, { studentId: c.studentId, problemId: FAKE, skillIds: [] }),
  },
  getProblem: { kind: 'student-scoped', linkedParentAllowed: false, call: (a, c) => getProblem(a, { studentId: c.studentId, problemId: FAKE }) },
  appendSolutionPlan: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) =>
      appendSolutionPlan(a, { studentId: c.studentId, problemId: FAKE, plan: {}, finalAnswer: {}, scopeExtension: null, verified: false, verifierOutput: null, llmCallId: null }),
  },
  getTeachingPlan: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => getTeachingPlan(a, { studentId: c.studentId, problemId: FAKE }),
  },
  getActiveSessionProblem: {
    kind: 'student-scoped',
    linkedParentAllowed: false,
    call: (a, c) => getActiveSessionProblem(a, { studentId: c.studentId, sessionId: c.sessionId }),
  },
  listApprovedMisconceptions: { kind: 'no-actor', reason: 'danh mục misconception đã duyệt, không có dữ liệu học sinh' },
  listSkillNames: { kind: 'no-actor', reason: 'danh mục skill, không có dữ liệu học sinh' },
};
