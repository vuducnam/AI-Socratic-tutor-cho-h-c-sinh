import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { createFlag } from '@/server/dal/flags-dal';
import { appendSolutionPlan, listApprovedMisconceptions, listSkillNames, setProblemSkills } from '@/server/dal/problems-dal';
import { createProgressSuggestion } from '@/server/dal/progress-suggestions-dal';
import type { LlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import {
  applyHomeworkExtension,
  decideProblemScope,
  type CurriculumScope,
  type HomeworkExtension,
  type ScopeLesson,
  type ScopeSkill,
} from '@/server/domain/curriculum/scope';
import { callLlm, LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { verifyAnswer, type VerifyRequest } from './math-verifier-client';
import { planConsistencyProblems, solutionPlanSchema, type SolutionPlan } from './plan-schema';

// Pre-solver (SPEC §6 bước 2, §5c.4, §8.3): mỗi đề một solution plan đã verify bằng sympy và chỉ dùng
// skill trong phạm vi. Sai phạm vi hoặc verify fail → sinh lại; tổng cộng tối đa 2 lần sinh lại (3 lần gọi).
// Vẫn sai → không dạy bài này + cờ cho phụ huynh. KHÔNG BAO GIỜ dạy trên plan chưa verify.
// Bài về nhà cùng lớp vượt tiến độ → dạy với phạm vi mở thêm của riêng bài đó + gợi ý tiến độ cho phụ huynh.

export const PRESOLVE_PROMPT = 'presolve/v1';
export const MAX_REGENERATIONS = 2;

export const UNVERIFIED_MESSAGE = 'Cú chưa chắc bài này, bạn hỏi bố hoặc cô nhé.';
export const OUT_OF_SCOPE_MESSAGE = 'Bài này có phần bạn chưa học trên lớp, bạn hỏi bố hoặc cô nhé.';

export interface PresolveInput {
  studentId: string;
  sessionId: string;
  problemId: string;
  problemText: string;
  origin: 'homework' | 'generated' | 'mission';
  /** scope_snapshot của phiên (cố định trong phiên). */
  sessionScope: CurriculumScope;
  catalog: { lessons: ScopeLesson[]; skills: ScopeSkill[] };
  mode?: 'live' | 'eval';
  recorder?: LlmCallRecorder;
}

export type PresolveResult =
  | {
      ok: true;
      plan: SolutionPlan;
      solutionPlanId: string;
      scope: CurriculumScope;
      scopeExtension: HomeworkExtension | null;
      progressSuggestionId: string | null;
      attempts: number;
    }
  | { ok: false; reason: 'out_of_scope' | 'unverified'; message: string; attempts: number; flagId: string };

export interface PresolveDependencies {
  verify?: (req: VerifyRequest) => ReturnType<typeof verifyAnswer>;
  /**
   * Chỉ eval dùng: nhớ plan model trả về theo đúng đầu vào (system + lời nhắn), để nhiều hội thoại cùng đề
   * không gọi lại Opus. Kiểm phạm vi, sympy và ghi solution_plans vẫn chạy thật cho từng hội thoại.
   */
  planMemo?: Map<string, SolutionPlan>;
}

async function systemPromptFor(scope: CurriculumScope, grade: number) {
  const prompt = await loadPrompt(PRESOLVE_PROMPT);
  const [skills, misconceptions] = await Promise.all([
    listSkillNames(scope.allowedSkillIds),
    listApprovedMisconceptions(scope.allowedSkillIds),
  ]);
  const text = renderPrompt(prompt.content, {
    grade,
    curriculum_scope: renderCurriculumScope(scope),
    allowed_skills: skills.length ? skills.map((s) => `- ${s.skill_id}: ${s.name}`).join('\n') : '- (chưa có)',
    allowed_methods: scope.allowedMethods.length ? scope.allowedMethods.map((m) => `- ${m}`).join('\n') : '- (chưa ghi nhận)',
    forbidden_methods: scope.forbiddenMethods.length ? scope.forbiddenMethods.map((m) => `- ${m}`).join('\n') : '- (không có danh sách)',
    misconceptions: misconceptions.length ? misconceptions.map((m) => `- ${m.id}: ${m.description}`).join('\n') : '- (chưa có)',
  });
  return { text, misconceptionIds: new Set(misconceptions.map((m) => m.id)) };
}

let defaultVerify: (req: VerifyRequest) => ReturnType<typeof verifyAnswer> = (req) => verifyAnswer(req);
/** Chỉ cho test/eval chạy không có sidecar: thay verifier mặc định (gọi math-verifier qua HTTP). */
export function setDefaultVerifier(fn: ((req: VerifyRequest) => ReturnType<typeof verifyAnswer>) | null): void {
  defaultVerify = fn ?? ((req) => verifyAnswer(req));
}

export async function presolveProblem(actor: Actor, input: PresolveInput, deps: PresolveDependencies = {}): Promise<PresolveResult> {
  const verify = deps.verify ?? defaultVerify;
  let scope = input.sessionScope;
  let extension: HomeworkExtension | null = null;
  let feedback: string | null = null;
  let lastFailure: 'out_of_scope' | 'unverified' = 'unverified';
  let lastSkills: string[] = [];

  for (let attempt = 1; attempt <= MAX_REGENERATIONS + 1; attempt++) {
    const system = await systemPromptFor(scope, scope.grade);
    let plan: SolutionPlan;
    let llmCallId: string | null;
    const userContent = feedback ? `Đề bài:\n${input.problemText}\n\nLần trước chưa đạt: ${feedback}\nGiải lại.` : `Đề bài:\n${input.problemText}`;
    const memoKey = `${system.text}\u0000${userContent}`;
    try {
      const memoized = deps.planMemo?.get(memoKey);
      if (memoized) {
        plan = memoized;
        llmCallId = null;
      } else {
        const result = await callLlm({
          purpose: 'presolve',
          studentId: input.studentId,
          sessionId: input.sessionId,
          promptVersion: PRESOLVE_PROMPT,
          // Phần ổn định trong một bài được cache (SPEC §2.1).
          system: [{ text: system.text, cache: true }],
          messages: [{ role: 'user', content: userContent }],
          responseSchema: solutionPlanSchema,
          mode: input.mode,
          recorder: input.recorder,
        });
        plan = result.parsed!;
        llmCallId = result.llmCallId;
        deps.planMemo?.set(memoKey, plan);
      }
    } catch (err) {
      if (err instanceof LlmOutputInvalidError) {
        feedback = 'output không đúng schema JSON';
        continue;
      }
      throw err;
    }
    lastSkills = plan.skill_ids;

    // 1) Phạm vi kiến thức (code quyết định, không phải LLM).
    const decision = decideProblemScope(applyHomeworkExtension(scope, extension), { skillIds: plan.skill_ids, origin: input.origin }, input.catalog);
    if (decision.kind === 'homework_extension') {
      // Mở phạm vi riêng bài này rồi sinh lại theo cách giải của bài SGK mà đề thuộc về.
      extension = decision.extension;
      scope = applyHomeworkExtension(input.sessionScope, extension);
      await appendSolutionPlan(actor, {
        studentId: input.studentId,
        problemId: input.problemId,
        plan,
        finalAnswer: plan.final_answer,
        scopeExtension: extension,
        verified: false,
        verifierOutput: { skipped: 'scope_extended_regenerate' },
        llmCallId,
      });
      feedback = 'phạm vi đã được mở thêm cho bài về nhà này; giải theo cách giải được dùng';
      continue;
    }
    if (decision.kind === 'out_of_scope') {
      lastFailure = 'out_of_scope';
      await appendSolutionPlan(actor, {
        studentId: input.studentId,
        problemId: input.problemId,
        plan,
        finalAnswer: plan.final_answer,
        scopeExtension: extension,
        verified: false,
        verifierOutput: { rejected: 'out_of_scope', reason: decision.reason, skill_ids: decision.skillIds },
        llmCallId,
      });
      // Lớp trên / không map được: sinh lại một lần nữa có thể map khác; vẫn ngoài phạm vi thì dừng.
      feedback = `skill ${decision.skillIds.join(', ')} không nằm trong "Skill được dùng"`;
      continue;
    }

    // 2) Nhất quán + verify bằng sympy.
    const consistency = planConsistencyProblems(plan);
    const unknownMisconceptions = plan.misconception_ids.filter((id) => !system.misconceptionIds.has(id));
    const verifier = consistency.length ? null : await verify(plan.sympy_check);
    const verified = !consistency.length && !!verifier && 'ok' in verifier && verifier.ok === true;
    const planRowId = await appendSolutionPlan(actor, {
      studentId: input.studentId,
      problemId: input.problemId,
      plan: { ...plan, misconception_ids: plan.misconception_ids.filter((id) => system.misconceptionIds.has(id)) },
      finalAnswer: plan.final_answer,
      scopeExtension: extension,
      verified,
      verifierOutput: { consistency, unknown_misconceptions: unknownMisconceptions, verifier },
      llmCallId,
    });
    if (!verified) {
      lastFailure = 'unverified';
      feedback = consistency.length ? consistency.join('; ') : `máy kiểm không khớp (${verifier && 'detail' in verifier ? verifier.detail : 'không rõ'})`;
      continue;
    }

    await setProblemSkills(actor, { studentId: input.studentId, problemId: input.problemId, skillIds: plan.skill_ids });
    let progressSuggestionId: string | null = null;
    if (extension && input.origin === 'homework') {
      progressSuggestionId = await createProgressSuggestion(actor, {
        studentId: input.studentId,
        subject: scope.subject,
        lessonId: extension.lessonId,
        evidenceProblemId: input.problemId,
      });
    }
    return {
      ok: true,
      plan,
      solutionPlanId: planRowId,
      scope,
      scopeExtension: extension,
      progressSuggestionId,
      attempts: attempt,
    };
  }

  const flagId = await createFlag(actor, {
    studentId: input.studentId,
    sessionId: input.sessionId,
    type: lastFailure === 'out_of_scope' ? 'out_of_scope_problem' : 'presolve_unverified',
    severity: 'warning',
    detail: { problem_id: input.problemId, origin: input.origin, skill_ids: lastSkills },
  });
  return {
    ok: false,
    reason: lastFailure,
    message: lastFailure === 'out_of_scope' ? OUT_OF_SCOPE_MESSAGE : UNVERIFIED_MESSAGE,
    attempts: MAX_REGENERATIONS + 1,
    flagId,
  };
}
