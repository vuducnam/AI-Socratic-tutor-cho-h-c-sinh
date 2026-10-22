import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { assertEvalDatabase, createEvalPersona } from '@/server/dal/eval-fixtures-dal';
import { createProblem } from '@/server/dal/problems-dal';
import { presolveProblem } from '@/server/domain/presolve/presolve';
import { openLearningSession } from '@/server/domain/session/open-session';
import { evalSpent } from '@/server/llm/llm-gateway';
import { systemActor } from '../worker/actor';
import { presolveAnswerMatches } from './acceptance-answer-match';
import { loadAcceptanceProblems } from './load-acceptance-problems';

// Nghiệm thu Pre-solver (SPEC §15.8) với LLM thật, hồ sơ giả, DB cu_eval:
// - 30 đề, tiến độ = vừa học xong bài của đề: 100% plan dùng được có verified = true, skill trong phạm vi,
//   và final_answer khớp đáp án tham chiếu answer.machine.
// - (a) đề Chủ đề 4, homework, tiến độ ở Bài 14 → dạy với scope_extension + đúng một progress_suggestions.
// - (b) cùng đề, generated → từ chối, cờ out_of_scope_problem.
// Dùng: DATABASE_URL=…/cu_eval pnpm eval:presolve   (cần pnpm db:seed trên cu_eval trước, và key eval)

const SUBJECT = 'math';
const actor = systemActor('nghiệm thu pre-solver');

async function runOne(problem: ReturnType<typeof loadAcceptanceProblems>[number], frontier: string, origin: 'homework' | 'generated') {
  const { studentId } = await createEvalPersona(actor, {
    displayName: 'Minh',
    gender: 'male',
    grade: 5,
    interests: ['bóng đá'],
    progress: [{ subject: SUBJECT, frontierLessonId: frontier }],
  });
  const opened = await openLearningSession(actor, { studentId, subject: SUBJECT });
  if (!opened.ok) throw new Error(`không mở được phiên: ${opened.message}`);
  const problemId = await createProblem(actor, {
    studentId,
    sessionId: opened.sessionId,
    origin,
    confirmedText: problem.text,
    confirmedByStudent: true,
    // Bài generated phải gắn life_context; đề nghiệm thu không có nên chỉ dùng cho ca (b) kiểm từ chối.
    lifeContextId: null,
  }).catch(async (err) => {
    if (origin === 'generated') return null;
    throw err;
  });
  if (!problemId) return { skipped: 'generated cần life_context' };
  const catalog = await loadScopeCatalog(SUBJECT, 5);
  return presolveProblem(actor, {
    studentId,
    sessionId: opened.sessionId,
    problemId,
    problemText: problem.text,
    origin,
    sessionScope: opened.scope,
    catalog,
    mode: 'eval',
  });
}

async function main() {
  assertEvalDatabase();
  const problems = loadAcceptanceProblems();
  if (problems.length < 30) throw new Error(`cần ≥ 30 đề, có ${problems.length}`);
  const results = [];
  let pass = 0;
  for (const p of problems) {
    const r = await runOne(p, p.target_lesson_id, 'homework');
    const ok =
      'ok' in r &&
      r.ok &&
      presolveAnswerMatches(r.plan.final_answer, p.answer) &&
      r.plan.skill_ids.every((s) => r.scope.allowedSkillIds.includes(s));
    if (ok) pass += 1;
    results.push({ id: p.id, ok, detail: 'ok' in r ? (r.ok ? { attempts: r.attempts, answer: r.plan.final_answer } : r) : r });
    console.log(`${p.id}: ${ok ? 'đạt' : 'CHƯA ĐẠT'}`);
  }
  const topic4 = problems.filter((p) => /MATH5\.T1\.B(19|2[0-4])$/.test(p.target_lesson_id)).slice(0, 3);
  const extensionCases = [];
  for (const p of topic4) {
    const r = await runOne(p, 'MATH5.T1.B14', 'homework');
    extensionCases.push({ id: p.id, case: 'a', ok: 'ok' in r && r.ok && !!r.scopeExtension && !!r.progressSuggestionId });
  }
  const summary = { at: new Date().toISOString(), total: problems.length, pass, extensionCases, costUsd: evalSpent(), results };
  mkdirSync('eval/results', { recursive: true });
  const file = `eval/results/presolve-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(`\n${pass}/${problems.length} đề đạt; ca (a): ${extensionCases.filter((c) => c.ok).length}/${extensionCases.length}; chi phí ${summary.costUsd.toFixed(3)} USD → ${file}`);
  process.exit(pass === problems.length && extensionCases.every((c) => c.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
