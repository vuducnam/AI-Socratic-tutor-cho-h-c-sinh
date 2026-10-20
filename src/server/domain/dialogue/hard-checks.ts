import 'server-only';
import { compileTermSet, type TermDefinition } from '@/lib/term-pattern-matcher';
import { toCanonical } from '@/lib/vi-math-normalizer';

// Kiểm tra cứng bằng code, chạy TRƯỚC Guard (SPEC §6 bước 5). Fail → coi như Guard block với lý do tương ứng.
// - LENGTH: số câu, số từ, số câu hỏi theo preset.
// - LEAK: theo kiểu đáp án (khớp chuỗi thô báo nhầm: "5" nằm trong "0,5", số có sẵn trong đề):
//   number / number_list → token số đã chuẩn hoá (cả "0,5" lẫn "không phẩy năm") trùng đáp án mà KHÔNG
//   phải số liệu đề cho; relation / choice → mẫu khẳng định ("0,5 lớn hơn 0,45", "bạn Lan nhảy xa nhất").
// - SCOPE: khớp patterns của forbiddenTerms.
// - FORMAT: số thập phân dấu chấm (0.45) không được lọt ra UI học sinh.

export type HardCheckReason = 'LENGTH' | 'LEAK' | 'SCOPE' | 'FORMAT';

export interface FinalAnswerSpec {
  kind: 'number' | 'number_list' | 'relation' | 'choice';
  /** Dạng máy (dấu chấm), giống sympy_check.expected. */
  canonical: string | string[];
  /** Biểu thức kiểm của plan (relation: "0.5 > 0.45"). */
  expression: string;
  choiceLabel: string | null;
}

export interface HardCheckContext {
  maxSentences: number;
  maxWords: number;
  /** Số câu hỏi bắt buộc: 1 ở lớp 5; 0 cho lượt chào kết thúc hoặc PAUSE. */
  requiredQuestions: number;
  maxQuestions: number;
  finalAnswer: FinalAnswerSpec | null;
  /** Đề đã xác nhận (số trong đề không tính là lộ đáp án). */
  problemText: string;
  givenNumbers: string[];
  forbiddenTerms: TermDefinition[];
  /** expected_result của các bước con CHƯA hoàn thành (bỏ trống: không kiểm lộ bước trung gian). */
  pendingStepResults?: string[];
  /** Mọi lời con đã nói trong bài (nhắc lại số con đã tự nói không tính là lộ). */
  studentTexts?: string[];
}

export interface HardCheckResult {
  pass: boolean;
  reasons: HardCheckReason[];
  details: string[];
}

// ───────────────────────── Đếm câu, từ, câu hỏi ─────────────────────────

/** Tách câu theo . ! ? … (dấu phẩy thập phân không phải ranh giới câu). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|(?<=[.!?…])$/u)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

// ───────────────────────── Số ─────────────────────────

/** Chuẩn hoá giá trị số để so sánh: "0,50" / "0.5" → "0.5"; "1/3" giữ nguyên. */
export function normalizeNumber(value: string): string {
  const v = value.trim().replace(',', '.').replace(/\s/g, '');
  if (/^-?\d+\/\d+$/.test(v)) return v;
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v;
  const [int, frac = ''] = v.split('.');
  const f = frac.replace(/0+$/, '');
  const i = String(Number(int));
  return f ? `${i}.${f}` : i;
}

/** Mọi số trong văn bản (sau khi đổi số đọc bằng chữ sang chữ số), theo thứ tự xuất hiện. */
export function numbersIn(text: string): string[] {
  const canonical = toCanonical(text);
  return [...canonical.matchAll(/(?<![\d,])\d+(?:\/\d+|,\d+)?(?![\d])/g)].map((m) => normalizeNumber(m[0]));
}

function relationParts(expression: string): { left: string; op: string; right: string } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(<=|>=|==|=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(expression);
  return m ? { left: normalizeNumber(m[1]!), op: m[2]!, right: normalizeNumber(m[3]!) } : null;
}

const BIGGER = '(?:lớn hơn|to hơn|nhiều hơn|dài hơn|cao hơn|nặng hơn|>)';
const SMALLER = '(?:bé hơn|nhỏ hơn|ít hơn|ngắn hơn|thấp hơn|nhẹ hơn|<)';
const EQUAL = '(?:bằng nhau|bằng|=)';
const SUPERLATIVE = '(?:nhất)';

/** Số dạng Việt trong văn bản đã chuẩn hoá: "0.5" → mẫu khớp "0,5" (và "0,50"). */
function numberPattern(normalized: string): string {
  const [int, frac] = normalized.split('.');
  return frac ? `${int},${frac}0*` : `${int}(?:,0+)?`;
}

function relationLeak(text: string, answer: FinalAnswerSpec): boolean {
  const parts = relationParts(answer.expression);
  if (!parts) return false;
  const canonical = toCanonical(text).toLowerCase();
  const declaratives = splitSentences(canonical).filter((s) => !s.endsWith('?'));
  const a = numberPattern(parts.left);
  const b = numberPattern(parts.right);
  let big: string | null = null;
  let small: string | null = null;
  if (parts.op.startsWith('>')) [big, small] = [a, b];
  else if (parts.op.startsWith('<')) [big, small] = [b, a];
  const N = '(?<![\\d,])';
  const E = '(?![\\d,])';
  const patterns: RegExp[] = [];
  if (big && small) {
    patterns.push(new RegExp(`${N}${big}${E}[^.!?]{0,20}${BIGGER}[^.!?]{0,12}${N}${small}${E}`, 'u'));
    patterns.push(new RegExp(`${N}${small}${E}[^.!?]{0,20}${SMALLER}[^.!?]{0,12}${N}${big}${E}`, 'u'));
    patterns.push(new RegExp(`${BIGGER}\\s*(?:là\\s*)?(?:số\\s*)?${N}${big}${E}`, 'u'));
    patterns.push(new RegExp(`${SMALLER}\\s*(?:là\\s*)?(?:số\\s*)?${N}${small}${E}`, 'u'));
    patterns.push(new RegExp(`${N}${big}${E}\\s*(?:là\\s*)?(?:số\\s*)?${BIGGER}\\s*$`, 'u'));
  } else {
    patterns.push(new RegExp(`${N}${a}${E}[^.!?]{0,20}${EQUAL}[^.!?]{0,12}${N}${b}${E}`, 'u'));
    patterns.push(new RegExp(`hai số\\s*(?:này\\s*)?bằng nhau`, 'u'));
  }
  return declaratives.some((s) => patterns.some((p) => p.test(s.replace(/[.!…]+$/, ''))));
}

function choiceLeak(text: string, answer: FinalAnswerSpec): boolean {
  if (!answer.choiceLabel) return false;
  const label = answer.choiceLabel.normalize('NFC').toLowerCase();
  return splitSentences(text.normalize('NFC').toLowerCase())
    .filter((s) => !s.endsWith('?'))
    .some((s) => s.includes(label) && new RegExp(SUPERLATIVE, 'u').test(s));
}

function numberLeak(text: string, ctx: HardCheckContext, answer: FinalAnswerSpec): string[] {
  const given = new Set([...ctx.givenNumbers.map(normalizeNumber), ...numbersIn(ctx.problemText)]);
  const answers = [answer.canonical].flat().map(normalizeNumber);
  const inMessage = numbersIn(text);
  if (answer.kind === 'number') {
    return inMessage.filter((n) => answers.includes(n) && !given.has(n));
  }
  // number_list: lộ khi tin nhắn liệt kê đủ đáp án đúng thứ tự (mà thứ tự đó khác thứ tự trong đề).
  if (answers.length < 2) return [];
  const problemOrder = numbersIn(ctx.problemText).filter((n) => answers.includes(n)).join('|');
  const seq = inMessage.filter((n) => answers.includes(n)).join('|');
  return seq.includes(answers.join('|')) && answers.join('|') !== problemOrder ? [answers.join(', ')] : [];
}

// Lộ bước trung gian: tin có con số là kết quả của một bước con chưa làm (ví dụ con mới nói "3/10" mà Cú
// viết sẵn "0,3"). Không tính: số đề cho, chữ số nằm sẵn trong số của đề ("4" trong "0,45" — Cú hay hỏi
// "chữ số 4 đứng ở hàng nào"), và số con đã tự nói. Chỉ so số; lộ bằng chữ để Guard bắt.
function stepResultLeak(text: string, ctx: HardCheckContext): string[] {
  if (!ctx.pendingStepResults?.length) return [];
  const given = [...ctx.givenNumbers.map(normalizeNumber), ...numbersIn(ctx.problemText)];
  const givenSet = new Set(given);
  const digitsOfGiven = given.map((n) => n.replace(/\D/g, ''));
  const said = new Set((ctx.studentTexts ?? []).flatMap(numbersIn));
  const isGiven = (n: string) => givenSet.has(n) || (/^\d+$/.test(n) && digitsOfGiven.some((d) => d.includes(n)));
  const results = new Set(ctx.pendingStepResults.flatMap(numbersIn).filter((n) => !isGiven(n) && !said.has(n)));
  return [...new Set(numbersIn(text).filter((n) => results.has(n)))];
}

// ───────────────────────── Kiểm tra tổng ─────────────────────────

export function runHardChecks(message: string, ctx: HardCheckContext): HardCheckResult {
  const reasons = new Set<HardCheckReason>();
  const details: string[] = [];

  const sentences = splitSentences(message).length;
  const words = countWords(message);
  const questions = countQuestions(message);
  if (sentences > ctx.maxSentences) details.push(`${sentences} câu > ${ctx.maxSentences}`);
  if (words > ctx.maxWords) details.push(`${words} từ > ${ctx.maxWords}`);
  if (questions > ctx.maxQuestions || questions < ctx.requiredQuestions) {
    details.push(`${questions} câu hỏi (cần ${ctx.requiredQuestions}–${ctx.maxQuestions})`);
  }
  if (details.length) reasons.add('LENGTH');

  if (/(?<![\d.,])\d+\.\d{1,3}(?![\d.])/.test(message) && !/\d{1,3}(\.\d{3})+/.test(message)) {
    reasons.add('FORMAT');
    details.push('số thập phân dùng dấu chấm');
  }

  const answer = ctx.finalAnswer;
  if (answer) {
    if (answer.kind === 'number' || answer.kind === 'number_list') {
      const leaked = numberLeak(message, ctx, answer);
      if (leaked.length) {
        reasons.add('LEAK');
        details.push(`chứa đáp án ${leaked.join(', ')}`);
      }
    } else if (answer.kind === 'relation' ? relationLeak(message, answer) : choiceLeak(message, answer)) {
      reasons.add('LEAK');
      details.push('khẳng định kết quả so sánh/lựa chọn');
    }
  }

  const stepLeaks = stepResultLeak(message, ctx);
  if (stepLeaks.length) {
    reasons.add('LEAK');
    details.push(`nói sẵn kết quả bước con chưa làm: ${stepLeaks.join(', ')}`);
  }

  const scopeHits = compileTermSet(ctx.forbiddenTerms).match(message);
  if (scopeHits.length) {
    reasons.add('SCOPE');
    details.push(`thuật ngữ chưa học: ${[...new Set(scopeHits.map((h) => h.term))].join(', ')}`);
  }

  return { pass: reasons.size === 0, reasons: [...reasons], details };
}
