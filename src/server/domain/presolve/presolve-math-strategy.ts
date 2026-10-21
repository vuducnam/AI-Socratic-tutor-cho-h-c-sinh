import 'server-only';
import { listApprovedMisconceptions, listSkillNames } from '@/server/dal/problems-dal';
import { renderCurriculumScope } from '@/server/domain/curriculum/render-curriculum-scope';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import type { verifyAnswer, VerifyRequest } from './math-verifier-client';
import { mathPlanOutputSchema, planConsistencyProblems, type SolutionPlan } from './plan-schema';
import type { PresolveStrategy } from './presolve-strategy';

// Pre-solver Toán (SPEC §6 bước 2, §8.3): model giải theo cách SGK trong phạm vi, sympy kiểm đáp án cuối.

export const PRESOLVE_PROMPT = 'presolve/v1';

export function mathStrategy(deps: {
  verify: (req: VerifyRequest) => ReturnType<typeof verifyAnswer>;
  planMemo?: Map<string, SolutionPlan>;
}): PresolveStrategy {
  return {
    promptVersion: PRESOLVE_PROMPT,

    async system(scope) {
      const prompt = await loadPrompt(PRESOLVE_PROMPT);
      const [skills, misconceptions] = await Promise.all([
        listSkillNames(scope.allowedSkillIds),
        listApprovedMisconceptions(scope.allowedSkillIds),
      ]);
      const text = renderPrompt(prompt.content, {
        grade: scope.grade,
        curriculum_scope: renderCurriculumScope(scope),
        allowed_skills: skills.length ? skills.map((s) => `- ${s.skill_id}: ${s.name}`).join('\n') : '- (chưa có)',
        allowed_methods: scope.allowedMethods.length ? scope.allowedMethods.map((m) => `- ${m}`).join('\n') : '- (chưa ghi nhận)',
        forbidden_methods: scope.forbiddenMethods.length ? scope.forbiddenMethods.map((m) => `- ${m}`).join('\n') : '- (không có danh sách)',
        misconceptions: misconceptions.length ? misconceptions.map((m) => `- ${m.id}: ${m.description}`).join('\n') : '- (chưa có)',
      });
      return { text, misconceptionIds: new Set(misconceptions.map((m) => m.id)) };
    },

    async generate(systemText, call) {
      // Eval: nhớ plan theo đúng đầu vào để nhiều hội thoại cùng đề không gọi lại Opus.
      const memoKey = `${systemText}\u0000${call.userContent}`;
      const memoized = deps.planMemo?.get(memoKey);
      if (memoized) return { kind: 'plan', plan: memoized, llmCallId: null };
      const result = await callLlm({
        purpose: 'presolve',
        studentId: call.studentId,
        sessionId: call.sessionId,
        promptVersion: PRESOLVE_PROMPT,
        // Phần ổn định trong một bài được cache (SPEC §2.1).
        system: [{ text: systemText, cache: true }],
        messages: [{ role: 'user', content: call.userContent }],
        responseSchema: mathPlanOutputSchema,
        mode: call.mode,
        recorder: call.recorder,
      });
      const plan: SolutionPlan = result.parsed!;
      deps.planMemo?.set(memoKey, plan);
      return { kind: 'plan', plan, llmCallId: result.llmCallId };
    },

    async verify(plan) {
      const consistency = planConsistencyProblems(plan);
      const verifier = consistency.length || !plan.sympy_check ? null : await deps.verify(plan.sympy_check);
      const verified = !consistency.length && !!verifier && 'ok' in verifier && verifier.ok === true;
      return {
        verified,
        output: { consistency, verifier },
        feedback: consistency.length ? consistency.join('; ') : `máy kiểm không khớp (${verifier && 'detail' in verifier ? verifier.detail : 'không rõ'})`,
      };
    },
  };
}
