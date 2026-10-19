import 'server-only';
import { compileTermSet, normalizeForMatching, type TermDefinition } from '@/lib/term-pattern-matcher';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { normalizeNumber, numbersIn } from './hard-checks';

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

/** Đáp án của con khớp final_answer (so bằng code trên số đã chuẩn hoá). */
export function answerMatchesFinal(text: string, plan: SolutionPlan): boolean {
  const said = numbersIn(text);
  const lower = normalizeForMatching(text);
  const fa = plan.final_answer;
  switch (fa.kind) {
    case 'number':
      return said.includes(normalizeNumber(String(fa.canonical)));
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
      // "0,5 lớn hơn", "0,45 bé hơn 0,5", hoặc chỉ nói số lớn hơn khi đề hỏi "số nào lớn hơn".
      const bigFirst = said.indexOf(r.big);
      const smallFirst = said.indexOf(r.small);
      if (bigFirst >= 0 && smallFirst < 0) return !SMALLER.test(lower);
      if (smallFirst >= 0 && bigFirst < 0) return SMALLER.test(lower);
      if (bigFirst >= 0 && smallFirst >= 0) {
        return (bigFirst < smallFirst && BIGGER.test(lower)) || (smallFirst < bigFirst && SMALLER.test(lower));
      }
      return false;
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
      return expected.length > 0 && expected.every((n) => said.has(n));
    })
    .map((s) => s.step_id);
}

/** Con giải thích cách làm/chỗ từng nhầm ở CONSOLIDATE: câu trả lời có nội dung (≥ 4 từ, có chữ). */
export function looksLikeExplanation(text: string): boolean {
  return text.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 4;
}

export function isSkip(text: string): boolean {
  return /^(bỏ qua|không biết|chịu|thôi|con không biết|em không biết)[.!]*$/u.test(normalizeForMatching(text));
}
