import 'server-only';
import type { Actor } from '@/server/dal/actor';
import { createFlag } from '@/server/dal/flags-dal';
import { appendSolutionPlan, setProblemSkills } from '@/server/dal/problems-dal';
import { createProgressSuggestion } from '@/server/dal/progress-suggestions-dal';
import type { LlmCallRecorder } from '@/server/dal/llm-calls-dal';
import {
  applyHomeworkExtension,
  decideProblemScope,
  type CurriculumScope,
  type HomeworkExtension,
  type ScopeLesson,
  type ScopeSkill,
} from '@/server/domain/curriculum/scope';
import { findSubject } from '@/server/domain/curriculum/subject-config';
import { LlmOutputInvalidError } from '@/server/llm/llm-gateway';
import { verifyAnswer, type VerifyRequest } from './math-verifier-client';
import type { SolutionPlan } from './plan-schema';
import { knowledgeStrategy } from './presolve-knowledge-strategy';
import { mathStrategy } from './presolve-math-strategy';
import type { PresolveStrategy } from './presolve-strategy';

// Pre-solver (SPEC §6 bước 2, §5c.4, §5d, §8.3): mỗi đề một solution plan đã kiểm bằng code và chỉ dùng skill
// trong phạm vi. Toán kiểm bằng sympy, môn kiến thức kiểm bằng ý chính đã duyệt (cách kiểm theo config/subjects.yaml).
// Sai phạm vi hoặc kiểm fail → sinh lại; tổng cộng tối đa 2 lần sinh lại (3 lần gọi). Vẫn sai → không dạy bài này
// + cờ cho phụ huynh. KHÔNG BAO GIỜ dạy trên plan chưa kiểm.
// Bài về nhà cùng lớp vượt tiến độ → dạy với phạm vi mở thêm của riêng bài đó + gợi ý tiến độ cho phụ huynh.

export { PRESOLVE_PROMPT } from './presolve-math-strategy';
export const MAX_REGENERATIONS = 2;

export const UNVERIFIED_MESSAGE = 'Mít chưa chắc bài này, bạn hỏi bố hoặc cô nhé.';
export const OUT_OF_SCOPE_MESSAGE = 'Bài này có phần bạn chưa học trên lớp, bạn hỏi bố hoặc cô nhé.';
export const NOT_COVERED_MESSAGE = 'Mít chưa tìm thấy điều này trong sách của bạn, bạn hỏi bố hoặc cô nhé.';

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

let defaultVerify: (req: VerifyRequest) => ReturnType<typeof verifyAnswer> = (req) => verifyAnswer(req);
/** Chỉ cho test/eval chạy không có sidecar: thay verifier mặc định (gọi math-verifier qua HTTP). */
export function setDefaultVerifier(fn: ((req: VerifyRequest) => ReturnType<typeof verifyAnswer>) | null): void {
  defaultVerify = fn ?? ((req) => verifyAnswer(req));
}

/** Cách giải + kiểm theo môn của phạm vi (môn không có trong config, như môn thử của test, coi là Toán). */
function strategyFor(subject: string, deps: PresolveDependencies): PresolveStrategy {
  return findSubject(subject)?.verifier === 'key_facts' ? knowledgeStrategy() : mathStrategy({ verify: deps.verify ?? defaultVerify, planMemo: deps.planMemo });
}

export async function presolveProblem(actor: Actor, input: PresolveInput, deps: PresolveDependencies = {}): Promise<PresolveResult> {
  const strategy = strategyFor(input.sessionScope.subject, deps);
  let scope = input.sessionScope;
  let extension: HomeworkExtension | null = null;
  let feedback: string | null = null;
  let lastFailure: 'out_of_scope' | 'unverified' | 'not_covered' = 'unverified';
  let lastSkills: string[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_REGENERATIONS + 1; attempt++) {
    attempts = attempt;
    const system = await strategy.system(scope, input.catalog);
    const userContent = feedback ? `Đề bài:\n${input.problemText}\n\nLần trước chưa đạt: ${feedback}\nGiải lại.` : `Đề bài:\n${input.problemText}`;
    let generated;
    try {
      generated = await strategy.generate(system.text, {
        studentId: input.studentId,
        sessionId: input.sessionId,
        userContent,
        mode: input.mode,
        recorder: input.recorder,
      });
    } catch (err) {
      if (err instanceof LlmOutputInvalidError) {
        feedback = 'output không đúng schema JSON';
        continue;
      }
      throw err;
    }
    if (generated.kind === 'invalid') {
      feedback = generated.reason;
      continue;
    }
    if (generated.kind === 'not_covered') {
      // Sách không nói tới điều con hỏi: sinh lại không giúp được, không dạy, báo bố mẹ.
      lastFailure = 'not_covered';
      feedback = generated.reason;
      break;
    }
    const { plan, llmCallId } = generated;
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

    // 2) Kiểm bằng code (+ sympy với Toán).
    const unknownMisconceptions = plan.misconception_ids.filter((id) => !system.misconceptionIds.has(id));
    const check = await strategy.verify(plan, input.problemText);
    const planRowId = await appendSolutionPlan(actor, {
      studentId: input.studentId,
      problemId: input.problemId,
      plan: { ...plan, misconception_ids: plan.misconception_ids.filter((id) => system.misconceptionIds.has(id)) },
      finalAnswer: plan.final_answer,
      scopeExtension: extension,
      verified: check.verified,
      verifierOutput: { ...check.output, unknown_misconceptions: unknownMisconceptions },
      llmCallId,
    });
    if (!check.verified) {
      lastFailure = 'unverified';
      feedback = check.feedback;
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
    detail: {
      problem_id: input.problemId,
      origin: input.origin,
      skill_ids: lastSkills,
      ...(lastFailure === 'not_covered' ? { not_covered: feedback } : {}),
    },
  });
  return {
    ok: false,
    reason: lastFailure === 'out_of_scope' ? 'out_of_scope' : 'unverified',
    message: lastFailure === 'out_of_scope' ? OUT_OF_SCOPE_MESSAGE : lastFailure === 'not_covered' ? NOT_COVERED_MESSAGE : UNVERIFIED_MESSAGE,
    attempts: lastFailure === 'not_covered' ? attempts : MAX_REGENERATIONS + 1,
    flagId,
  };
}
