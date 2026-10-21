import 'server-only';
import { compileTermSet, normalizeForMatching, type TermDefinition } from '@/lib/term-pattern-matcher';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { normalizeNumber, numbersIn } from './hard-checks';
import { relationClaim } from './relation-claim';
import { findFrustrationPhrase, soundsUnsure } from './signals';

// Phân tích tin nhắn của con bằng code (quy tắc cứng 7: code quyết định, LLM chỉ đề xuất):
// tín hiệu cần người lớn, câu hỏi tò mò vượt phạm vi, đáp án khớp final_answer, bước con đã xong.

// Cụm từ cần người lớn (SPEC §13). Khớp nguyên từ trên văn bản chuẩn hoá. Danh sách thận trọng: báo nhầm
// (PAUSE + báo bố mẹ) an toàn hơn bỏ sót.
const ADULT_NEEDED_PHRASES: TermDefinition[] = [
  { term: 'bị bắt nạt', patterns: ['bắt nạt', 'bị đánh', 'bị đe doạ', 'bị đe dọa', 'bị dọa', 'bị doạ'] },
  { term: 'tự làm hại', patterns: ['muốn chết', 'tự tử', 'tự làm đau', 'không muốn sống', 'chết đi cho rồi', 'tự cắt'] },
  { term: 'buồn kéo dài', patterns: ['buồn lắm', 'buồn quá', 'khóc mãi', 'không ai thương', 'cô đơn quá', 'sợ lắm'] },
  { term: 'người lạ', patterns: ['người lạ nhắn', 'người lạ rủ', 'bảo em giữ bí mật'] },
];
const adultNeededMatcher = compileTermSet(ADULT_NEEDED_PHRASES);

export function detectAdultNeeded(text: string): string[] {
  return [...new Set(adultNeededMatcher.match(text).map((m) => m.term))];
}

/** Con hỏi điều chưa học (khớp thuật ngữ bị cấm của phạm vi) → cờ beyond_scope_curiosity. */
export function detectBeyondScopeCuriosity(text: string, forbiddenTerms: TermDefinition[]): string[] {
  return [...new Set(compileTermSet(forbiddenTerms).match(text).map((m) => m.term))];
}

const BIGGER = /(lớn hơn|to hơn|nhiều hơn|dài hơn|cao hơn|nặng hơn|lớn nhất|>)/u;
const SMALLER = /(bé hơn|nhỏ hơn|ít hơn|ngắn hơn|thấp hơn|nhẹ hơn|bé nhất|nhỏ nhất|<)/u;

function relationOf(expression: string) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(<|>|==|=)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(expression);
  if (!m) return null;
  const a = normalizeNumber(m[1]!);
  const b = normalizeNumber(m[3]!);
  if (m[2] === '>') return { big: a, small: b };
  if (m[2] === '<') return { big: b, small: a };
  return { equal: [a, b] as const };
}

/** "hay 3,07", "hay là 10 phần 3", "hoặc 0,5": nhóm 1 là phần ngay sau từ nối, chứa phương án con đưa ra. */
// Nhóm 1 nằm trong lookahead để không nuốt mất "hay" kế tiếp ("hay là 3,07? Hay là 3,007").
const ALTERNATIVE = /(?<![\p{L}\p{M}])(?:hay|hoặc)(?:\s+là)?\s+(?=(\S+(?:\s+\S+){0,3}))/gu;

/**
 * Con đưa nhiều phương án để đoán ("3,7 phải không? Hay là 3,07? Hay là 3,007?", "3 phần 10 hay 10 phần 3?",
 * "10 phần nhỏ. À hay là 1 phần?"): số đứng ngay sau "hay/hoặc" khác `wanted` và không phải số trong đề
 * hay kết quả bước nào. Số trung gian trong lời giải thích ("mỗi phần là 0,1") không đứng sau "hay/hoặc".
 */
function offersAlternatives(text: string, wanted: string[], plan: SolutionPlan): boolean {
  const known = new Set([...plan.given_numbers.flatMap((n) => numbersIn(n)), ...plan.steps.flatMap((s) => numbersIn(s.expected_result))]);
  return [...normalizeForMatching(text).matchAll(ALTERNATIVE)]
    .map((m) => numbersIn(m[1]!)[0])
    .some((n) => n !== undefined && !wanted.includes(n) && !known.has(n));
}

/** Đáp án của con khớp final_answer (so bằng code trên số đã chuẩn hoá). */
export function answerMatchesFinal(text: string, plan: SolutionPlan): boolean {
  const said = numbersIn(text);
  const lower = normalizeForMatching(text);
  const fa = plan.final_answer;
  switch (fa.kind) {
    case 'number': {
      const want = normalizeNumber(String(fa.canonical));
      return said.includes(want) && !offersAlternatives(text, [want], plan);
    }
    case 'number_list': {
      const want = [fa.canonical].flat().map(normalizeNumber).join('|');
      return said.filter((n) => want.split('|').includes(n)).join('|').includes(want);
    }
    case 'choice':
      return !!fa.choice_label && lower.includes(fa.choice_label.normalize('NFC').toLowerCase());
    case 'relation': {
      const r = relationOf(plan.sympy_check.expression);
      if (!r) return false;
      if ('equal' in r) return /bằng nhau|bằng|=/.test(lower);
      // Đọc mệnh đề so sánh theo từng câu; có một khẳng định sai là chưa khớp.
      const claim = relationClaim(text, r.big, r.small);
      if (claim) return claim === 'correct';
      // Không có mệnh đề: chỉ nói đúng số lớn hơn (đề hỏi "số nào lớn hơn"), không nhắc số kia.
      return said.includes(r.big) && !said.includes(r.small) && !BIGGER.test(lower) && !SMALLER.test(lower);
    }
  }
}

/** Bước có expected_result là số mà con vừa nói ra → coi là con đã tự hoàn thành bước đó. */
export function stepsCompletedBy(text: string, plan: SolutionPlan, alreadyDone: string[]): string[] {
  const said = new Set(numbersIn(text));
  return plan.steps
    .filter((s) => !alreadyDone.includes(s.step_id))
    .filter((s) => {
      const expected = numbersIn(s.expected_result);
      return expected.length > 0 && expected.every((n) => said.has(n)) && !offersAlternatives(text, expected, plan);
    })
    .map((s) => s.step_id);
}

// Từ chỉ lý do / cách làm / chỗ từng nhầm. Khớp nguyên từ trên văn bản chuẩn hoá.
const REASON_WORDS = /(?<![\p{L}\p{M}\p{N}])(vì|tại|bởi|nên|do|cho nên|lúc nãy|lúc đầu|ban đầu|nhầm|tưởng|cách|trước tiên|đầu tiên|rồi mới|so sánh|so từng)(?![\p{L}\p{M}\p{N}])/u;

// Thêm cách nói suy luận hay gặp ở trẻ ("nếu… thì", "giống như…", "vậy 7 đứng ở…"; "vậy là 0,3?" không tính).
const INFERENCE_WORDS = /(?<![p{L}p{M}p{N}])(nếu|giống như|khớp|vậy(?!s+là))(?![p{L}p{M}p{N}])/u;

/** Con có nêu lý do ("vì…", "nên…", "nếu…"), kể cả khi vẫn hỏi lại "đúng không?". */
export function givesReason(text: string): boolean {
  const lower = normalizeForMatching(text);
  return REASON_WORDS.test(lower) || INFERENCE_WORDS.test(lower);
}

/**
 * Con giải thích cách làm/chỗ từng nhầm (ở CONSOLIDATE, hoặc lập luận ở chế độ argue): ≥ 4 từ, có từ chỉ lý
 * do, và con không tự nói là đoán / đang rối. "Mình đoán thôi, thấy có 3 với 10 nên ghép lại" chưa phải
 * giải thích — Cú hỏi tiếp thay vì chuyển sang câu hỏi chuyển giao.
 */
export function looksLikeExplanation(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
  const lower = normalizeForMatching(text);
  return words >= 4 && REASON_WORDS.test(lower) && !soundsUnsure(text) && findFrustrationPhrase(text) === null && !/(?<![\p{L}])(rối|lộn)(?![\p{L}])/u.test(lower);
}

export function isSkip(text: string): boolean {
  return /^(bỏ qua|không biết|chịu|thôi|con không biết|em không biết)[.!]*$/u.test(normalizeForMatching(text));
}
