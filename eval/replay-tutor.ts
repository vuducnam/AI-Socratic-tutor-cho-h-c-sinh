import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertEvalDatabase, listRecordedTutorRequests } from '@/server/dal/eval-fixtures-dal';
import type { DialogueState } from '@/server/domain/dialogue/state-machine';
import { runHardChecks, type HardCheckContext } from '@/server/domain/dialogue/hard-checks';
import { tutorConversationMessages, type BlockedDraft } from '@/server/domain/dialogue/tutor-conversation-messages';
import { tutorOutputSchema } from '@/server/domain/dialogue/tutor-output-schema';
import { stateGuidance, TUTOR_FEWSHOT, TUTOR_PROMPT, VOLATILE_MARKER } from '@/server/domain/dialogue/tutor-prompt';
import { callLlm, evalSpent } from '@/server/llm/llm-gateway';
import { renderPrompt } from '@/server/llm/prompt-loader';
import { systemActor } from '../worker/actor';
import { extractPromptVariables } from './prompt-variable-extractor';

// pnpm eval:replay [--from=tutor/v4] [--limit=30]
// Thử nhanh một prompt tutor mới mà không chạy cả hội thoại: lấy các yêu cầu tutor đã ghi trong cu_eval
// (lượt viết đầu), tách giá trị biến khỏi bản render bằng prompt cũ, render lại bằng prompt hiện tại rồi gửi
// lại cho model; chấm bằng chính kiểm tra cứng của app, tối đa 3 lần viết như pipeline thật.
// Chỉ đo độ dài / số câu hỏi / lộ số đáp án bằng code — không thay eval:smoke (không có Guard, judge, học sinh giả).

const MAX_ATTEMPTS = 3;
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

function previousVersion(current: string): string {
  const m = /^(.*\/v)(\d+)$/.exec(current);
  if (!m || Number(m[2]) < 2) throw new Error(`không suy ra được phiên bản trước của ${current}; truyền --from=`);
  return `${m[1]}${Number(m[2]) - 1}`;
}

const promptFile = (id: string) => readFileSync(`prompts/${id}.md`, 'utf8');

function hardContext(vars: Record<string, string>): HardCheckContext {
  const plan = vars.plan && vars.plan !== '(chưa có)' ? (JSON.parse(vars.plan) as { final_answer: { kind: string; canonical: string | string[]; choice_label: string | null } }) : null;
  const terminal = vars.state === 'DONE' || vars.state === 'PAUSE';
  return {
    maxSentences: Number(vars.max_sentences),
    maxWords: Number(vars.max_words_per_turn),
    requiredQuestions: terminal ? 0 : 1,
    maxQuestions: Number(vars.max_questions_per_turn),
    finalAnswer: plan ? { kind: plan.final_answer.kind, canonical: plan.final_answer.canonical, expression: '', choiceLabel: plan.final_answer.choice_label } : null,
    problemText: vars.problem_text ?? '',
    givenNumbers: [],
    // Thuật ngữ cấm không nằm trong prompt đã render; eval:smoke mới kiểm phần này.
    forbiddenTerms: [],
  } as HardCheckContext;
}

async function main() {
  assertEvalDatabase();
  const from = arg('from') ?? previousVersion(TUTOR_PROMPT);
  const limit = Number(arg('limit') ?? '30');
  const oldTemplate = promptFile(from);
  const newTemplate = promptFile(TUTOR_PROMPT);
  const fewshot = promptFile(TUTOR_FEWSHOT);
  const requests = await listRecordedTutorRequests(systemActor('eval-replay'), { promptVersion: from, limit });
  if (!requests.length) throw new Error(`cu_eval chưa có yêu cầu tutor nào với ${from}`);
  console.log(`Gửi lại ${requests.length} yêu cầu ${from} → ${TUTOR_PROMPT}\n`);

  const results: { firstPass: boolean; finalPass: boolean; attempts: number; reasons: string[]; message: string }[] = [];
  for (const req of requests) {
    const vars = extractPromptVariables(oldTemplate, req.system.map((b) => b.text), VOLATILE_MARKER);
    if (!vars) {
      console.log('BỎ QUA: không tách được biến (bản render không khớp prompt cũ)');
      continue;
    }
    // Phần lấy từ file/code thay vì giá trị cũ: few-shot và hướng dẫn trạng thái hiện tại.
    vars.fewshot = fewshot;
    vars.state_guidance = stateGuidance(vars.state as DialogueState);
    const [stable, volatile] = renderPrompt(newTemplate, vars).split(VOLATILE_MARKER);
    const system = [{ text: stable!.trim(), cache: true }, { text: (volatile ?? '').trim() }];
    const ctx = hardContext(vars);

    let blocked: BlockedDraft | null = null;
    let firstPass = false;
    let message = '';
    let reasons: string[] = [];
    let attempt = 0;
    for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const r = await callLlm({
        mode: 'eval',
        purpose: 'tutor',
        studentId: req.studentId,
        sessionId: req.sessionId,
        promptVersion: `${TUTOR_PROMPT}-replay`,
        system,
        messages: tutorConversationMessages(req.messages, blocked),
        responseSchema: tutorOutputSchema,
      });
      message = r.parsed!.message;
      const hard = runHardChecks(message, ctx);
      reasons = hard.reasons;
      if (hard.pass) break;
      blocked = { message, feedback: `${hard.reasons.join(', ')} (${hard.details.join('; ')})` };
    }
    const finalPass = reasons.length === 0;
    if (attempt === 1 && finalPass) firstPass = true;
    results.push({ firstPass, finalPass, attempts: Math.min(attempt, MAX_ATTEMPTS), reasons, message });
    console.log(`${finalPass ? 'ĐẠT' : 'CHẶN'} (lần ${Math.min(attempt, MAX_ATTEMPTS)}${reasons.length ? `, ${reasons.join(', ')}` : ''}) | ${message}`);
  }

  const n = results.length;
  const pct = (k: number) => `${k}/${n} (${n ? Math.round((k / n) * 100) : 0}%)`;
  const leak = results.filter((r) => r.reasons.includes('LEAK')).length;
  console.log(`\nĐạt ngay lần 1: ${pct(results.filter((r) => r.firstPass).length)}`);
  console.log(`Đạt sau tối đa ${MAX_ATTEMPTS} lần viết: ${pct(results.filter((r) => r.finalPass).length)}`);
  console.log(`Còn bị chặn LEAK (code): ${leak}`);
  console.log(`Chi phí: ${evalSpent().toFixed(3)} USD`);
  mkdirSync('eval/results', { recursive: true });
  const file = `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}-replay.json`;
  writeFileSync(file, JSON.stringify({ from, to: TUTOR_PROMPT, costUsd: evalSpent(), results }, null, 2));
  console.log(`Kết quả: ${file}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
