import 'server-only';
import { toCanonical } from '@/lib/vi-math-normalizer';

// Đọc mệnh đề so sánh trong lời con ("0,5 lớn hơn 0,45", "0,45 < 0,5", "số lớn hơn là 0,5") theo từng câu,
// để biết con khẳng định đúng hay sai. Không đoán theo vị trí số trong cả tin nhắn: "Chắc 0,45 lớn hơn vì
// có 45 mà 5 thì nhỏ hơn" là khẳng định SAI dù có chữ "nhỏ hơn" ở cuối.

const BIGGER = '(?:lớn hơn|to hơn|nhiều hơn|dài hơn|cao hơn|nặng hơn|lớn nhất|>)';
const SMALLER = '(?:bé hơn|nhỏ hơn|ít hơn|ngắn hơn|thấp hơn|nhẹ hơn|bé nhất|nhỏ nhất|<)';
const N = '(?<![\\d,])';
const E = '(?![\\d,])';

/** "0.5" → mẫu khớp "0,5" và "0,50" trong văn bản đã chuẩn hoá. */
function numberPattern(normalized: string): string {
  const [int, frac] = normalized.split('.');
  return frac ? `${N}${int},${frac}0*${E}` : `${N}${int}(?:,0+)?${E}`;
}

/** big, small: giá trị đã chuẩn hoá (dấu chấm), big > small. null nếu con không khẳng định gì. */
export function relationClaim(text: string, big: string, small: string): 'correct' | 'wrong' | null {
  const b = numberPattern(big);
  const s = numberPattern(small);
  const full = {
    correct: [new RegExp(`${b}[^.!?]{0,20}${BIGGER}[^.!?]{0,12}${s}`, 'u'), new RegExp(`${s}[^.!?]{0,20}${SMALLER}[^.!?]{0,12}${b}`, 'u')],
    wrong: [new RegExp(`${s}[^.!?]{0,20}${BIGGER}[^.!?]{0,12}${b}`, 'u'), new RegExp(`${b}[^.!?]{0,20}${SMALLER}[^.!?]{0,12}${s}`, 'u')],
  };
  const partial = {
    correct: [
      new RegExp(`${b}\\s*(?:thì\\s*|là\\s*)?(?:số\\s*)?${BIGGER}`, 'u'),
      new RegExp(`${s}\\s*(?:thì\\s*|là\\s*)?(?:số\\s*)?${SMALLER}`, 'u'),
      new RegExp(`${BIGGER}\\s*là\\s*(?:số\\s*)?${b}`, 'u'),
      new RegExp(`${SMALLER}\\s*là\\s*(?:số\\s*)?${s}`, 'u'),
    ],
    wrong: [
      new RegExp(`${s}\\s*(?:thì\\s*|là\\s*)?(?:số\\s*)?${BIGGER}`, 'u'),
      new RegExp(`${b}\\s*(?:thì\\s*|là\\s*)?(?:số\\s*)?${SMALLER}`, 'u'),
      new RegExp(`${BIGGER}\\s*là\\s*(?:số\\s*)?${s}`, 'u'),
      new RegExp(`${SMALLER}\\s*là\\s*(?:số\\s*)?${b}`, 'u'),
    ],
  };
  let correct = false;
  let wrong = false;
  const canonical = toCanonical(text).normalize('NFC').toLowerCase();
  for (const sentence of canonical.split(/[.!?\n]+/u)) {
    // Câu có mệnh đề đủ hai vế thì chỉ đọc mệnh đề đó (tránh "bé hơn 0,5" trong "0,45 bé hơn 0,5" bị đọc ngược).
    const fullCorrect = full.correct.some((p) => p.test(sentence));
    const fullWrong = full.wrong.some((p) => p.test(sentence));
    if (fullCorrect || fullWrong) {
      correct ||= fullCorrect;
      wrong ||= fullWrong;
      continue;
    }
    correct ||= partial.correct.some((p) => p.test(sentence));
    wrong ||= partial.wrong.some((p) => p.test(sentence));
  }
  if (wrong) return 'wrong';
  return correct ? 'correct' : null;
}
