import 'server-only';
import { FRUSTRATION_PHRASES } from './frustration-phrases';

// Tín hiệu hội thoại (SPEC §7): hàm thuần, không DB, không LLM. State machine nhận kết quả của
// các hàm này làm input; không hàm nào ở đây tự quyết định chuyển trạng thái.

/** Một lượt của con, đã được code đánh giá là có tiến triển hay không (ví dụ: hoàn thành bước con). */
export interface ProgressMark {
  madeProgress: boolean;
}

/** Một lần con trả lời: đáp án (null nếu lượt đó không có đáp án) và thời gian phản hồi. */
export interface AnswerAttempt {
  answer: string | null;
  responseTimeMs: number;
}

export type FrustrationSignal =
  | { frustrated: false; rule: null }
  | { frustrated: true; rule: 'phrase'; phrase: string }
  | { frustrated: true; rule: 'short_repeat' };

/** Câu trả lời tối đa bấy nhiêu từ thì tính là "cụt" (SPEC §7: ≤ 2 từ). */
export const SHORT_ANSWER_MAX_WORDS = 2;
/** Đoán bừa: số lần đổi đáp án tối thiểu trong cửa sổ, kích thước cửa sổ (lượt), ngưỡng thời gian. */
export const GUESS_MIN_CHANGES = 2;
export const GUESS_WINDOW_TURNS = 3;
export const GUESS_FAST_RESPONSE_MS = 3000;

// Ranh giới từ Unicode: không dùng `\b` vì `\b` coi chữ có dấu tiếng Việt là ký tự ngoài từ.
// Gồm cả \p{M} để dấu kết hợp còn sót sau NFC không bị coi là ranh giới.
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';

/** Chuẩn hoá text tiếng Việt để so khớp: NFC, chữ thường, gộp khoảng trắng. */
export function normalizeVietnameseText(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseRegExp(phrase: string): RegExp {
  // Khoảng trắng trong cụm từ khớp một hoặc nhiều khoảng trắng (text đã được gộp nhưng vẫn an toàn).
  const body = escapeRegExp(normalizeVietnameseText(phrase)).replace(/ /g, '\\s+');
  return new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'u');
}

// Biên dịch một lần khi nạp module; cụm dài trước để `phrase` trả về cụm cụ thể nhất.
const PHRASE_MATCHERS: readonly { phrase: string; re: RegExp }[] = [...FRUSTRATION_PHRASES]
  .map((p) => normalizeVietnameseText(p))
  .filter((p) => p.length > 0)
  .sort((a, b) => b.length - a.length)
  .map((phrase) => ({ phrase, re: phraseRegExp(phrase) }));

/** Tìm cụm từ nản đầu tiên (cụ thể nhất) có trong text, hoặc null. */
export function findFrustrationPhrase(text: string): string | null {
  const normalized = normalizeVietnameseText(text);
  if (normalized === '') return null;
  for (const { phrase, re } of PHRASE_MATCHERS) {
    if (re.test(normalized)) return phrase;
  }
  return null;
}

/** Đếm từ: token chứa ít nhất một chữ hoặc số (dấu câu đứng riêng không tính). */
export function countWords(text: string): number {
  const normalized = normalizeVietnameseText(text);
  if (normalized === '') return 0;
  return normalized.split(' ').filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** Bỏ dấu câu ở hai đầu để "không." và "không" coi là cùng một câu trả lời. */
function canonicalShortAnswer(text: string): string {
  return normalizeVietnameseText(text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Số lượt liên tiếp gần nhất (tính từ cuối mảng, mảng theo thứ tự cũ → mới) con không có tiến triển.
 */
export function noProgressStreak(turns: readonly ProgressMark[]): number {
  let streak = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.madeProgress !== false) break;
    streak++;
  }
  return streak;
}

/**
 * Tín hiệu nản từ tin nhắn hiện tại của con.
 * - `phrase`: chứa một cụm trong `FRUSTRATION_PHRASES`.
 * - `short_repeat`: câu trả lời ≤ 2 từ lặp lại y nguyên câu ngay trước (`recentStudentTexts` theo thứ tự
 *   cũ → mới, không gồm `text`). Câu chứa chữ số bị loại khỏi luật này: con nhắc lại một đáp án số
 *   ("12", "12") là đang giữ đáp án, không phải nản.
 */
export function detectFrustration(text: string, recentStudentTexts: readonly string[]): FrustrationSignal {
  const phrase = findFrustrationPhrase(text);
  if (phrase !== null) return { frustrated: true, rule: 'phrase', phrase };

  const current = canonicalShortAnswer(text);
  const words = countWords(current);
  if (words === 0 || words > SHORT_ANSWER_MAX_WORDS || /\p{N}/u.test(current)) {
    return { frustrated: false, rule: null };
  }
  const previous = recentStudentTexts[recentStudentTexts.length - 1];
  if (previous !== undefined && canonicalShortAnswer(previous) === current) {
    return { frustrated: true, rule: 'short_repeat' };
  }
  return { frustrated: false, rule: null };
}

function isFast(ms: number): boolean {
  // Thời gian không hợp lệ (âm, NaN, vô cực) coi như không biết → không tính là nhanh.
  return Number.isFinite(ms) && ms >= 0 && ms < GUESS_FAST_RESPONSE_MS;
}

/**
 * Đoán bừa: trong 3 lượt gần nhất (mảng cũ → mới) con đổi đáp án ≥ 2 lần, và mỗi lần đổi được tính
 * chỉ khi lượt đổi đó phản hồi < 3 giây. Đáp án so sánh sau chuẩn hoá text; lượt không có đáp án
 * không tạo ra lần đổi và cắt chuỗi so sánh (so với đáp án gần nhất trước đó trong cửa sổ).
 */
export function detectGuessing(attempts: readonly AnswerAttempt[]): boolean {
  const window = attempts.slice(-GUESS_WINDOW_TURNS);
  let lastAnswer: string | null = null;
  let fastChanges = 0;
  for (const attempt of window) {
    if (attempt.answer === null) continue;
    const answer = normalizeVietnameseText(attempt.answer);
    if (answer === '') continue;
    if (lastAnswer !== null && answer !== lastAnswer && isFast(attempt.responseTimeMs)) fastChanges++;
    lastAnswer = answer;
  }
  return fastChanges >= GUESS_MIN_CHANGES;
}
