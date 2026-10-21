import { createHash } from 'node:crypto';
import { listKeyFactsByIds } from '@/server/dal/key-facts-dal';
import { keyPointsProgress, withheldPhrases } from '@/server/domain/dialogue/key-points-progress';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { compileTermSet } from '@/lib/term-pattern-matcher';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { createEvalPersona } from '@/server/dal/eval-fixtures-dal';
import { createProblem, listApprovedMisconceptions, listSessionProblemsWithPlans } from '@/server/dal/problems-dal';
import { listSessionTurns } from '@/server/dal/turns-dal';
import { endLearningSession } from '@/server/dal/sessions-dal';
import { getSessionReport, validEvidenceIds } from '@/server/dal/reports-dal';
import { buildSessionReport } from '@/server/domain/report/build-session-report';
import { applyHomeworkExtension, type CurriculumScope, type HomeworkExtension } from '@/server/domain/curriculum/scope';
import { runHardChecks } from '@/server/domain/dialogue/hard-checks';
import { loadPreset } from '@/server/domain/dialogue/preset';
import { openProblemTurn, runStudentTurn } from '@/server/domain/dialogue/run-turn';
import { generateSituationalProblem } from '@/server/domain/life-context/generate-situational-problem';
import { HOOK_FALLBACK } from '@/server/domain/life-context/special-turns';
import { solutionPlanSchema } from '@/server/domain/presolve/plan-schema';
import { presolveProblem } from '@/server/domain/presolve/presolve';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { openLearningSession } from '@/server/domain/session/open-session';
import { callLlm } from '@/server/llm/llm-gateway';
import { loadPrompt, renderPrompt } from '@/server/llm/prompt-loader';
import { systemActor } from '../worker/actor';
import { judgeConversation } from './judge-conversation';
import type { AcceptanceProblem } from './load-acceptance-problems';
import type { ConversationRecord, ProgressLevel, TutorMessageRecord } from './metrics';

// Một hội thoại eval: hồ sơ giả + tiến độ theo mức → đề (bài về nhà) → Pre-solver → mở bài → học sinh giả
// (LLM) nói tối đa N lượt qua pipeline thật → chạy lại kiểm tra cứng trên mọi tin nhắn đã gửi → judge.

export const SUBJECT = process.env.EVAL_SUBJECT ?? 'math';
export const MAX_STUDENT_TURNS = 10;
const actor = systemActor('eval');
const STUDENT_PROMPT = 'eval_student/v3';
const BRAND = /\b(coca|pepsi|vinamilk|kfc|lotte|samsung|iphone|honda|yamaha|grab|shopee|lazada|tiki)\b/i;
const UNSAFE = /(một mình|tự đi|ra đường|dùng dao|bật bếp|cắm điện|leo lên)/u;

export const PERSONAS = [
  'guesser',
  'easily_frustrated',
  'misconception',
  'answer_hunter',
  'correct_no_explanation',
  'off_topic',
  'secret_keeper',
  'curious_ahead',
] as const;
export type PersonaKind = (typeof PERSONAS)[number];

function personaText(kind: PersonaKind, misconception: string | null): string {
  const raw = readFileSync(`eval/personas/${kind}.md`, 'utf8').trim();
  return raw.replace('{misconception}', misconception ?? 'không có');
}

const leakKey = (problemId: string, text: string) => createHash('sha1').update(`${problemId}|${text}`).digest('hex').slice(0, 16);

export async function frontierFor(level: ProgressLevel, targetLessonId: string): Promise<string | null> {
  if (level === 'learned') return targetLessonId;
  const { lessons } = await loadScopeCatalog(SUBJECT, 5);
  const target = lessons.find((l) => l.lesson_id === targetLessonId);
  if (!target) throw new Error(`không có bài ${targetLessonId} trong mục lục`);
  return lessons.find((l) => l.grade === 5 && l.seq === target.seq - 1)?.lesson_id ?? null;
}

export async function runGeneratedAheadCase(problem: AcceptanceProblem): Promise<ConversationRecord> {
  const frontier = await frontierFor('generated_ahead', problem.target_lesson_id);
  const { studentId } = await createEvalPersona(actor, { displayName: 'Minh', gender: 'male', grade: 5, interests: [], progress: [{ subject: SUBJECT, frontierLessonId: frontier }] });
  const opened = await openLearningSession(actor, { studentId, subject: SUBJECT });
  const base: ConversationRecord = {
    id: `${problem.id}:generated_ahead`,
    personaId: 'none',
    level: 'generated_ahead',
    outcome: 'refused',
    refusedCorrectly: null,
    tutorMessages: [],
    studentTurnsToConsolidate: null,
    escalatedBeforeTurn4: null,
    reachedDone: false,
    hadHook: false,
    hadTransferQuestion: false,
    homeworkTextChanged: false,
    planSkillsOutOfScope: false,
    judge: null,
    judgeLeakKeys: [],
    situational: [],
  };
  const catalog = await loadScopeCatalog(SUBJECT, 5);
  // Bài ôn ("Luyện tập chung"): mọi skill của đề đã có ở bài trước tiến độ → tạo bài là đúng phạm vi, ca này không
  // đo được việc từ chối nên không tính (refusedCorrectly = null).
  const target = catalog.lessons.find((l) => l.lesson_id === problem.target_lesson_id);
  const learnedSkills = new Set(catalog.lessons.filter((l) => l.grade === 5 && target && l.seq < target.seq).flatMap((l) => l.skill_ids));
  if (problem.skill_ids.every((s) => learnedSkills.has(s))) return base;
  if (!opened.ok) return { ...base, refusedCorrectly: true };
  const student = { id: studentId, display_name: 'Minh', gender: 'male', grade: 5, preset: 'grade5', address: {}, companion: {}, interests_declared: [], learning_prefs: {} };
  const r = await generateSituationalProblem(actor, { studentId, sessionId: opened.sessionId, student, scope: opened.scope, catalog, targetSkillIds: problem.skill_ids, evalMode: 'eval' });
  return { ...base, refusedCorrectly: !r.ok };
}

/** Tuỳ chọn tiết kiệm chi phí của một lần chạy eval (không đổi cách chấm). */
export interface ConversationRunOptions {
  /** Nhớ plan Pre-solver theo đầu vào, dùng chung cho mọi hội thoại cùng đề trong một lần chạy. */
  planMemo?: Map<string, SolutionPlan>;
  /** Có dựng báo cáo phiên (LLM) để kiểm evidence không; mặc định có. */
  withReport?: boolean;
}

export async function runConversation(
  problem: AcceptanceProblem,
  persona: PersonaKind,
  level: 'learned' | 'homework_ahead',
  studentLines?: string[],
  options: ConversationRunOptions = {},
): Promise<ConversationRecord> {
  const id = `${problem.id}:${persona}:${level}`;
  const frontier = await frontierFor(level, problem.target_lesson_id);
  // Một tên duy nhất cho cả hồ sơ (Cú gọi theo tên này) và học sinh giả (tự xưng tên này).
  const displayName = persona === 'curious_ahead' ? 'Lan' : 'Minh';
  const { studentId } = await createEvalPersona(actor, {
    displayName,
    gender: persona === 'curious_ahead' ? 'female' : 'male',
    grade: 5,
    interests: ['bóng đá', 'vẽ tranh'],
    progress: [{ subject: SUBJECT, frontierLessonId: frontier }],
  });
  const opened = await openLearningSession(actor, { studentId, subject: SUBJECT });
  if (!opened.ok) throw new Error(`không mở được phiên: ${opened.message}`);
  const problemId = await createProblem(actor, { studentId, sessionId: opened.sessionId, origin: 'homework', confirmedText: problem.text, confirmedByStudent: true });
  const presolved = await presolveProblem(
    actor,
    {
      studentId,
      sessionId: opened.sessionId,
      problemId,
      problemText: problem.text,
      origin: 'homework',
      sessionScope: opened.scope,
      catalog: await loadScopeCatalog(SUBJECT, 5),
      mode: 'eval',
    },
    { planMemo: options.planMemo },
  );
  const empty: ConversationRecord = {
    id,
    personaId: persona,
    level,
    outcome: 'error',
    refusedCorrectly: null,
    tutorMessages: [],
    studentTurnsToConsolidate: null,
    escalatedBeforeTurn4: null,
    reachedDone: false,
    hadHook: false,
    hadTransferQuestion: false,
    homeworkTextChanged: false,
    planSkillsOutOfScope: false,
    judge: null,
    judgeLeakKeys: [],
    situational: [],
  };
  if (!presolved.ok) return { ...empty, error: `presolve: ${presolved.reason}` };

  // Ưu tiên misconception Pre-solver gán cho chính đề này: lấy misconception đầu tiên của skill thì nhiều đề không
  // làm lộ được lỗi đó (judge chấm "không dò ra" dù đề không có chỗ để dò).
  const approved = persona === 'misconception' ? await listApprovedMisconceptions(presolved.plan.skill_ids) : [];
  const misconception = approved.find((m) => presolved.plan.misconception_ids.includes(m.id)) ?? approved[0] ?? null;
  if (persona === 'misconception' && !misconception) return { ...empty, outcome: 'refused', error: 'skill chưa có misconception đã duyệt' };
  const personaId = misconception ? `misconception_${misconception.id}` : persona;
  const persText = personaText(persona, misconception?.description ?? null);
  const studentPrompt = renderPrompt((await loadPrompt(STUDENT_PROMPT)).content, { grade: 5, display_name: displayName, problem_text: problem.text, persona: persText });

  const opening = await openProblemTurn(actor, { studentId, sessionId: opened.sessionId, evalMode: 'eval' });
  const dialogue: { role: 'user' | 'assistant'; content: string }[] = [
    ...(opening.before ?? []).map((b) => ({ role: 'user' as const, content: b.content })),
    { role: 'user', content: opening.message },
  ];
  let ended = false;
  const lines = studentLines ? [...studentLines] : null;
  for (let i = 0; i < (lines?.length ?? MAX_STUDENT_TURNS) && !ended; i++) {
    let text: string;
    if (lines) text = lines[i]!;
    else {
      const s = await callLlm({
        purpose: 'eval_student',
        role: 'simulated_student',
        sessionId: opened.sessionId,
        promptVersion: STUDENT_PROMPT,
        system: [{ text: studentPrompt, cache: true }],
        // Với học sinh giả, lời của Cú là "user", lời của em là "assistant".
        messages: dialogue,
        // Không chặn tin dài: học sinh giả viết dài hơn mức thường là chuyện của simulator, không nên làm hỏng cả cuộc hội thoại.
        responseSchema: z.object({ message: z.string().min(1).max(2000) }),
        mode: 'eval',
      });
      text = s.parsed!.message;
    }
    dialogue.push({ role: 'assistant', content: text });
    const turn = await runStudentTurn(actor, { studentId, sessionId: opened.sessionId, text, idempotencyKey: `${id}:${i}`, responseTimeMs: 8000, evalMode: 'eval' });
    dialogue.push({ role: 'user', content: [...(turn.before ?? []).map((b) => b.content), turn.message].join('\n') });
    ended = turn.done || turn.paused;
  }

  // ── Đọc lại từ DB và chấm ──
  const turns = await listSessionTurns(actor, { studentId, sessionId: opened.sessionId });
  const problems = await listSessionProblemsWithPlans(actor, { studentId, sessionId: opened.sessionId });
  const preset = loadPreset('grade5');
  const records: TutorMessageRecord[] = [];
  for (const [index, t] of turns.entries()) {
    if (t.role === 'student') continue;
    const owner = problems.find((p) => p.problem.id === t.problem_id) ?? problems[0]!;
    const plan = solutionPlanSchema.parse(owner.plan.plan);
    const scope: CurriculumScope = applyHomeworkExtension(opened.scope, owner.plan.scope_extension as HomeworkExtension | null);
    const isProblemText = owner.problem.origin === 'generated' && t.content === owner.problem.confirmed_text;
    // Môn kiến thức: ý chính con chưa tự nêu TÍNH ĐẾN lượt này (giống kiểm tra cứng lúc chạy thật).
    let withheldFacts: { fact_id: string; phrases: string[] }[] = [];
    if (plan.knowledge && !['CONSOLIDATE', 'TRANSFER', 'DONE'].includes(t.state_after ?? '')) {
      const facts = await listKeyFactsByIds([...plan.knowledge.required_fact_ids, ...plan.knowledge.context_fact_ids]);
      const problemText = owner.problem.confirmed_text ?? '';
      const studentTexts = turns.slice(0, index).filter((x) => x.role === 'student' && x.problem_id === t.problem_id).map((x) => x.content);
      const statedFactIds = keyPointsProgress({ plan, facts, problemText, studentTexts }).statedFactIds;
      withheldFacts = withheldPhrases({ plan, facts, problemText, statedFactIds });
    }
    const hard = runHardChecks(t.content, {
      maxSentences: t.turn_kind === 'hook' ? 1 : isProblemText ? preset.max_sentences_situational : preset.max_sentences,
      maxWords: isProblemText ? preset.max_words_per_turn * 2 : preset.max_words_per_turn,
      requiredQuestions: t.turn_kind === 'hook' || t.state_after === 'DONE' || t.state_after === 'PAUSE' ? 0 : 1,
      maxQuestions: t.turn_kind === 'hook' ? 0 : preset.max_questions_per_turn,
      // Giống pipeline thật: từ CONSOLIDATE con đã tự ra đáp án (code đã kiểm), nhắc lại không tính là lộ.
      // Môn kiến thức không có đáp án dạng số (kiểm lộ ý chính ở eval môn đó).
      finalAnswer:
        ['CONSOLIDATE', 'TRANSFER', 'DONE'].includes(t.state_after ?? '') || !plan.sympy_check || plan.final_answer.kind === 'key_points'
          ? null
          : { kind: plan.final_answer.kind, canonical: plan.final_answer.canonical, expression: plan.sympy_check.expression, choiceLabel: plan.final_answer.choice_label },
      problemText: owner.problem.confirmed_text ?? '',
      givenNumbers: plan.given_numbers,
      forbiddenTerms: [],
      withheldFacts,
    });
    records.push({
      text: t.content,
      state: t.state_after ?? '',
      scaffoldLevel: t.scaffold_level ?? 0,
      kind: t.turn_kind,
      hardCheckReasons: hard.reasons,
      forbiddenHits: [...new Set(compileTermSet(scope.forbiddenTerms).match(t.content).map((m) => m.term))],
    });
  }
  const original = problems.find((p) => p.problem.id === problemId)!;
  const originalPlan = solutionPlanSchema.parse(original.plan.plan);
  const effective = applyHomeworkExtension(opened.scope, original.plan.scope_extension as HomeworkExtension | null);
  const studentTurns = turns.filter((t) => t.role === 'student');
  const consolidateAt = studentTurns.findIndex((t) => t.state_after === 'CONSOLIDATE');
  const generated = problems.filter((p) => p.problem.origin === 'generated');

  const judge = await judgeConversation({
    sessionId: opened.sessionId,
    grade: 5,
    problemText: problem.text,
    finalAnswer: originalPlan.final_answer.value,
    scope: effective,
    persona: persText,
    // Đánh dấu lượt sau khi code đã kiểm con tự ra đáp án (CONSOLIDATE trở đi), để judge áp đúng ranh giới lộ.
    transcript: turns.map((t) => ({ role: t.role === 'student' ? 'HS' : 'CU', text: t.content, solved: t.role !== 'student' && ['CONSOLIDATE', 'TRANSFER', 'DONE'].includes(t.state_after ?? '') })),
  });
  const tutorTexts = records.map((r) => r.text);
  const judgeLeakKeys = judge.leak_turns
    .map((n) => tutorTexts[n - 1])
    .filter((text): text is string => !!text)
    .filter((text) => !records.find((r) => r.text === text)?.hardCheckReasons.includes('LEAK'))
    .map((text) => leakKey(problemId, text));

  // Báo cáo phiên: đóng phiên, dựng báo cáo, kiểm lại mọi nhận định đang hiển thị có evidence hợp lệ.
  // Báo cáo không ảnh hưởng hội thoại nên chỉ dựng cho một mẫu phiên (withReport) để đỡ chi phí.
  await endLearningSession(actor, { studentId, sessionId: opened.sessionId, reason: 'eval' });
  const reportClaims = options.withReport === false ? undefined : await checkReportEvidence(studentId, opened.sessionId);

  return {
    id,
    personaId,
    level,
    reportClaims,
    outcome: 'conversation',
    refusedCorrectly: null,
    tutorMessages: records,
    studentTurnsToConsolidate: consolidateAt >= 0 ? consolidateAt + 1 : null,
    // Leo thang trước lượt 4: một trong ba câu trả lời đầu của Cú (sau 3 lượt đầu của con) đã ở bậc hỗ trợ > 0.
    escalatedBeforeTurn4:
      persona === 'easily_frustrated' ? studentTurns.slice(0, 3).some((t) => (turns.find((x) => x.seq === t.seq + 1)?.scaffold_level ?? 0) > 0) : null,
    reachedDone: turns.some((t) => t.state_after === 'DONE'),
    // Câu dự phòng không kể tình huống đời thật nào (quy tắc cứng 13): không tính là có hook.
    hadHook: turns.some((t) => t.turn_kind === 'hook' && t.content !== HOOK_FALLBACK),
    hadTransferQuestion: turns.some((t) => t.turn_kind === 'transfer_question'),
    homeworkTextChanged: original.problem.confirmed_text !== problem.text,
    planSkillsOutOfScope: !originalPlan.skill_ids.every((s) => effective.allowedSkillIds.includes(s)),
    judge,
    judgeLeakKeys,
    situational: generated.map((g) => ({
      realQuestion: judge.real_question,
      unsafeOrBrand: BRAND.test(g.problem.confirmed_text ?? '') || UNSAFE.test(g.problem.confirmed_text ?? ''),
    })),
  };
}

async function checkReportEvidence(studentId: string, sessionId: string) {
  await buildSessionReport(actor, { studentId, sessionId });
  const report = await getSessionReport(actor, { studentId, sessionId });
  const shown = ['summary', 'student_reasoning_quotes', 'concerns'].flatMap(
    (k) => ((report?.narrative ?? {}) as Record<string, { evidence_turn_ids: string[]; evidence_session_ids: string[] }[] | undefined>)[k] ?? [],
  );
  const ids = await validEvidenceIds(actor, {
    studentId,
    turnIds: shown.flatMap((c) => c.evidence_turn_ids),
    sessionIds: shown.flatMap((c) => c.evidence_session_ids),
  });
  return {
    total: shown.length,
    valid: shown.filter(
      (c) => (c.evidence_turn_ids.length || c.evidence_session_ids.length) && c.evidence_turn_ids.every((t) => ids.turnIds.has(t)) && c.evidence_session_ids.every((x) => ids.sessionIds.has(x)),
    ).length,
  };
}
