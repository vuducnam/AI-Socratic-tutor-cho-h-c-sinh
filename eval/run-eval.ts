import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { loadScopeCatalog } from '@/server/dal/curriculum-dal';
import { assertEvalDatabase } from '@/server/dal/eval-fixtures-dal';
import { EvalBudgetExceededError, evalSpent } from '@/server/llm/llm-gateway';
import { loadAcceptanceProblems } from './load-acceptance-problems';
import { computeMetrics, type ConversationRecord, type LeakDecisions } from './metrics';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { PERSONAS, runConversation, runGeneratedAheadCase, SUBJECT, type PersonaKind } from './run-conversation';
import { ciPassed, evaluateThresholds } from './thresholds';

// pnpm eval        : chạy đầy đủ, in metric (không chặn)
// pnpm eval:ci     : chạy đầy đủ, exit ≠ 0 khi leak > 0 hoặc ngưỡng chặn bị vi phạm (hoặc vượt trần chi phí)
// pnpm eval:smoke  : golden + 5 bài × 8 persona, mức "vừa học" — cho hằng ngày
// Lọc để thử nhanh một thay đổi: --personas=easily_frustrated,guesser  --problems=DEC5-01,DEC5-04
// Tiết kiệm (không đổi cách chấm): plan Pre-solver nhớ theo đầu vào và dùng chung cho các hội thoại cùng đề;
// báo cáo phiên chỉ dựng cho EVAL_REPORT_SAMPLE phiên rải đều (mặc định 5) để kiểm evidence.
// Ma trận (quy tắc cứng 15): mỗi bài × persona chạy ở (1) vừa học xong bài của đề, (2) chưa học, bài về nhà
// → dạy với phạm vi mở thêm; và (3) chưa học, bài Cú tạo → bộ chọn không sinh bài.
// Chỉ chạy trên DB cu_eval, hồ sơ giả; key + trần chi phí riêng, không fallback OpenRouter.

const mode = process.argv.includes('--smoke') ? 'smoke' : 'full';
const ci = process.argv.includes('--ci');
const DECISIONS_FILE = 'eval/results/leak-decisions.json';
const listArg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',').filter(Boolean) ?? null;
const personaFilter = listArg('personas');
const problemFilter = listArg('problems');
const REPORT_SAMPLE = Number(process.env.EVAL_REPORT_SAMPLE ?? '5');

function registryTestPassed(): boolean {
  try {
    // Test registry chạy trên cu_test (.env.test), không trên DB eval.
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_OWNER_URL;
    execSync('pnpm vitest run src/server/transparency/registry.test.ts', { stdio: 'pipe', env });
    return true;
  } catch {
    return false;
  }
}

async function termCoverage(maxSeq: number) {
  const { lessons } = await loadScopeCatalog(SUBJECT, 5);
  const upTo = lessons.filter((l) => l.grade === 5 && l.seq <= maxSeq);
  return { lessonsWithTerms: upTo.filter((l) => l.introduces_terms.length || l.methods.length).length, lessonsTotal: upTo.length };
}

async function main() {
  assertEvalDatabase();
  const problems = loadAcceptanceProblems();
  const usable = problems.filter((p) => p.skill_ids.length);
  if (!usable.length) throw new Error('Đề nghiệm thu chưa có skill_ids (phase 00 D3b) — chưa chạy eval được');
  const unknownPersonas = (personaFilter ?? []).filter((x) => !(PERSONAS as readonly string[]).includes(x));
  if (unknownPersonas.length) throw new Error(`persona không có: ${unknownPersonas.join(', ')} (có: ${PERSONAS.join(', ')})`);
  const personas = personaFilter ? PERSONAS.filter((x) => personaFilter.includes(x)) : [...PERSONAS];
  const selected = problemFilter ? usable.filter((p) => problemFilter.includes(p.id)) : mode === 'smoke' ? usable.slice(0, 5) : usable;
  if (!selected.length) throw new Error(`không có đề nào khớp --problems=${problemFilter?.join(',')}`);
  const levels = mode === 'smoke' ? (['learned'] as const) : (['learned', 'homework_ahead'] as const);
  const filtered = !!(personaFilter || problemFilter);
  // Chạy một phần không chứng minh được leak = 0 trên cả bộ, nên không dùng làm cổng merge.
  if (ci && filtered) throw new Error('eval:ci phải chạy đủ bộ: bỏ --personas/--problems');
  const planMemo = new Map<string, SolutionPlan>();
  const planned = selected.length * personas.length * levels.length;
  const reportEvery = Math.max(1, Math.ceil(planned / Math.max(1, REPORT_SAMPLE)));
  let convIndex = 0;
  const records: ConversationRecord[] = [];
  let aborted: string | null = null;

  try {
    if ((mode === 'smoke' || ci) && !filtered) {
      const golden = parse(readFileSync('eval/golden/golden-conversations.yaml', 'utf8')) as {
        conversations: { id: string; subject: string; problem_text: string; student_lines: string[]; skip_reason?: string }[];
      };
      for (const g of golden.conversations) {
        if (g.skip_reason) {
          console.log(`golden ${g.id}: bỏ qua (${g.skip_reason})`);
          continue;
        }
        const match = usable.find((p) => p.text.includes('0,45') && p.text.includes('0,5'));
        if (!match) {
          console.log(`golden ${g.id}: bỏ qua (chưa có đề tương ứng trong bộ đề)`);
          continue;
        }
        const rec = await runConversation({ ...match, text: g.problem_text }, 'guesser', 'learned', g.student_lines, { planMemo, withReport: false });
        records.push({ ...rec, id: `golden:${g.id}` });
        console.log(`golden ${g.id}: xong`);
      }
    }
    for (const p of selected) {
      for (const persona of personas as PersonaKind[]) {
        for (const level of levels) {
          try {
            const withReport = convIndex++ % reportEvery === 0;
            const rec = await runConversation(p, persona, level, undefined, { planMemo, withReport });
            records.push(rec);
            console.log(`${rec.id}: ${rec.outcome}`);
          } catch (err) {
            if (err instanceof EvalBudgetExceededError) throw err;
            records.push({ id: `${p.id}:${persona}:${level}`, personaId: persona, level, outcome: 'error', error: String(err) } as ConversationRecord);
            console.log(`${p.id}:${persona}:${level}: LỖI ${String(err)}`);
          }
        }
      }
      if (mode === 'full') records.push(await runGeneratedAheadCase(p));
    }
  } catch (err) {
    if (!(err instanceof EvalBudgetExceededError)) throw err;
    aborted = err.message;
  }

  const decisions: LeakDecisions = existsSync(DECISIONS_FILE) ? JSON.parse(readFileSync(DECISIONS_FILE, 'utf8')) : {};
  const maxSeq = Math.max(...(await loadScopeCatalog(SUBJECT, 5)).lessons.filter((l) => selected.some((p) => p.target_lesson_id === l.lesson_id)).map((l) => l.seq));
  const metrics = computeMetrics(records, { leakDecisions: decisions, registryTestPassed: registryTestPassed(), termCoverage: await termCoverage(maxSeq) });
  const outcomes = evaluateThresholds(metrics.values);
  const passed = !aborted && ciPassed(outcomes) && !records.some((r) => r.outcome === 'error');

  mkdirSync('eval/results', { recursive: true });
  const file = `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}.json`;
  writeFileSync(file, JSON.stringify({ mode, ci, aborted, costUsd: evalSpent(), metrics, outcomes, records }, null, 2));

  console.log(`\n=== Eval ${mode} — ${records.length} bản ghi, chi phí ${evalSpent().toFixed(2)} USD ===`);
  for (const o of outcomes) {
    const v = o.value === null ? '—' : Number.isInteger(o.value) ? o.value : o.value.toFixed(3);
    console.log(`${o.status.padEnd(9)} ${o.label}: ${v} (n=${o.n}, cần ${o.comparator} ${o.target})${o.deferredUntil ? ` [hoãn: ${o.deferredUntil}]` : ''}`);
  }
  console.log(`Độ phủ thuật ngữ: ${metrics.termCoverage.lessonsWithTerms}/${metrics.termCoverage.lessonsTotal} bài đã có introduces_terms/methods (0% thuật ngữ cấm chỉ có nghĩa trên phần đã phủ).`);
  if (metrics.pendingLeakReviews.length) {
    console.log(`Judge báo lộ đáp án mà code không bắt: ${metrics.pendingLeakReviews.length} ca — xác nhận từng ca trong ${DECISIONS_FILE} ("leak" | "not_leak").`);
  }
  if (aborted) console.log(`DỪNG: ${aborted}`);
  console.log(`Kết quả: ${file}`);
  process.exit(ci && !passed ? 1 : aborted ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
