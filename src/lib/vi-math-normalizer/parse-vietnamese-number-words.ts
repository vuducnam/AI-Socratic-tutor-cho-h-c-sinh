// Đọc chữ số tiếng Việt thành số (chiều chữ → số), dùng cho toCanonical.
// Nhận cách đọc chuẩn và cách đọc vùng miền phổ biến: "lăm"/"nhăm", "mốt", "tư", "linh"/"lẻ",
// "nghìn"/"ngàn", "tỷ"/"tỉ", "bảy"/"bẩy", "chục"; khẩu ngữ "bốn lăm" (45), "hai mốt" (21),
// "một trăm hai" (120), "một nghìn hai" (1 200).
// Không nhận "năm" làm hàng đơn vị sau "mười"/"mươi" hay đứng trơ sau "trăm"/"nghìn" vì dễ nhầm với
// "năm" = năm tháng ("hai mươi năm", "một trăm năm"); cách đọc đúng của 25, 15 là "lăm".
//
// Mọi hàm nhận `words`: mảng từ đã viết thường, chỉ số `i` là vị trí bắt đầu.
// Phần tử không phải chữ số (chữ số Ả Rập, dấu câu) đơn giản là không khớp nên việc đọc dừng lại.

type Words = readonly string[];

const DIGIT_VALUES = new Map<string, number>([
  ['không', 0], ['một', 1], ['hai', 2], ['ba', 3], ['bốn', 4], ['năm', 5],
  ['sáu', 6], ['bảy', 7], ['bẩy', 7], ['tám', 8], ['chín', 9],
]);

/** Hàng đơn vị sau "mươi"/"chục": "hai mươi mốt", "ba mươi tư", "bốn mươi lăm" / "bốn mươi nhăm". */
const UNITS_AFTER_TENS = new Map<string, number>([
  ['một', 1], ['mốt', 1], ['hai', 2], ['ba', 3], ['bốn', 4], ['tư', 4], ['lăm', 5], ['nhăm', 5],
  ['sáu', 6], ['bảy', 7], ['bẩy', 7], ['tám', 8], ['chín', 9],
]);

/** Hàng đơn vị sau "mười": "mười một", "mười bốn"/"mười tư", "mười lăm". */
const UNITS_AFTER_TEN = new Map<string, number>([
  ['một', 1], ['hai', 2], ['ba', 3], ['bốn', 4], ['tư', 4], ['lăm', 5], ['nhăm', 5],
  ['sáu', 6], ['bảy', 7], ['bẩy', 7], ['tám', 8], ['chín', 9],
]);

/** Hàng đơn vị sau "linh"/"lẻ": "một trăm linh năm", "một trăm lẻ tư". */
const UNITS_AFTER_LINH = new Map<string, number>([
  ['một', 1], ['hai', 2], ['ba', 3], ['bốn', 4], ['tư', 4], ['năm', 5],
  ['sáu', 6], ['bảy', 7], ['bẩy', 7], ['tám', 8], ['chín', 9],
]);

/** Khẩu ngữ bỏ "mươi": "hai mốt" = 21, "bốn lăm" = 45. Chỉ nhận các từ không đứng một mình được. */
const ABBREVIATED_UNITS = new Map<string, number>([['mốt', 1], ['lăm', 5], ['nhăm', 5]]);

const LINH_WORDS = new Set(['linh', 'lẻ']);
const TENS_WORDS = new Set(['mươi', 'chục']);
const MULTIPLIERS = new Map<string, number>([
  ['nghìn', 1_000], ['ngàn', 1_000], ['triệu', 1_000_000], ['tỷ', 1_000_000_000], ['tỉ', 1_000_000_000],
]);

/** Các từ cho thấy chữ số đứng trước còn là một phần của cụm số lớn hơn. */
const NUMBER_CONTINUATIONS = new Set(['trăm', ...TENS_WORDS, ...ABBREVIATED_UNITS.keys(), ...MULTIPLIERS.keys()]);

export interface ParsedNumber {
  value: number;
  /** Vị trí ngay sau từ cuối cùng đã đọc. */
  end: number;
}

export function isDigitWord(word: string | undefined): boolean {
  return word !== undefined && DIGIT_VALUES.has(word);
}

/** Đọc một nhóm 0..999. `afterMultiplier`: nhóm đứng sau "nghìn"/"triệu"/"tỷ". */
function parseChunk(words: Words, i: number, afterMultiplier: boolean): ParsedNumber | null {
  let k = i;
  let value = 0;
  let hasHundreds = false;
  const hundreds = DIGIT_VALUES.get(words[k] ?? '');
  if (hundreds !== undefined && words[k + 1] === 'trăm') {
    value = hundreds * 100;
    k += 2;
    hasHundreds = true;
  }
  const onlyHundreds: ParsedNumber | null = hasHundreds ? { value, end: k } : null;
  const word = words[k];
  if (word === undefined) return onlyHundreds;

  if (LINH_WORDS.has(word)) {
    const unit = UNITS_AFTER_LINH.get(words[k + 1] ?? '');
    if (unit !== undefined && (hasHundreds || afterMultiplier)) return { value: value + unit, end: k + 2 };
    return onlyHundreds;
  }

  if (word === 'mười') {
    const unit = UNITS_AFTER_TEN.get(words[k + 1] ?? '');
    return unit === undefined ? { value: value + 10, end: k + 1 } : { value: value + 10 + unit, end: k + 2 };
  }

  const digit = DIGIT_VALUES.get(word);
  if (digit === undefined) return onlyHundreds;
  const next = words[k + 1];

  if (next !== undefined && TENS_WORDS.has(next) && (digit >= 2 || (digit === 1 && next === 'chục'))) {
    const unit = UNITS_AFTER_TENS.get(words[k + 2] ?? '');
    const tens = value + digit * 10;
    return unit === undefined ? { value: tens, end: k + 2 } : { value: tens + unit, end: k + 3 };
  }

  const abbreviated = ABBREVIATED_UNITS.get(next ?? '');
  if (abbreviated !== undefined && digit >= 2) return { value: value + digit * 10 + abbreviated, end: k + 2 };

  if (hasHundreds) {
    // Khẩu ngữ "một trăm hai" = 120. Bỏ qua "không" và "năm" (dễ là "năm" = năm tháng).
    if (digit >= 1 && word !== 'năm') return { value: value + digit * 10, end: k + 1 };
    return onlyHundreds;
  }
  // Chữ số trơ ngay sau hàng nghìn/triệu do parseInteger xử lý (khẩu ngữ), ở đây không nhận.
  if (afterMultiplier) return null;
  return { value: digit, end: k + 1 };
}

/**
 * Đọc số nguyên tới hàng tỷ: "hai nghìn không trăm hai mươi sáu" → 2026, "một triệu linh năm" → 1 000 005.
 * Trả null nếu tại `i` không có cụm số.
 */
export function parseIntegerWords(words: Words, i: number): ParsedNumber | null {
  let total = 0;
  let k = i;
  let lastMultiplier = Number.POSITIVE_INFINITY;
  let afterMultiplier = false;
  let found = false;

  for (;;) {
    if (afterMultiplier) {
      // Khẩu ngữ "một nghìn hai" = 1 200, "hai triệu ba" = 2 300 000.
      const word = words[k];
      const digit = DIGIT_VALUES.get(word ?? '');
      const next = words[k + 1];
      if (digit !== undefined && digit >= 1 && word !== 'năm' && !NUMBER_CONTINUATIONS.has(next ?? '')) {
        total += (digit * lastMultiplier) / 10;
        k += 1;
        break;
      }
    }
    const chunk = parseChunk(words, k, afterMultiplier);
    if (!chunk) break;
    const multiplier = MULTIPLIERS.get(words[chunk.end] ?? '');
    if (multiplier !== undefined && multiplier < lastMultiplier) {
      total += chunk.value * multiplier;
      lastMultiplier = multiplier;
      k = chunk.end + 1;
      afterMultiplier = true;
      found = true;
      continue;
    }
    total += chunk.value;
    k = chunk.end;
    found = true;
    break;
  }
  return found ? { value: total, end: k } : null;
}

export interface ParsedDigits {
  /** Chuỗi chữ số, giữ nguyên số 0 đứng đầu ("05"). */
  digits: string;
  end: number;
}

/**
 * Đọc phần sau "phẩy": các "không" đứng đầu, một nhóm 0..999, rồi các chữ số đọc rời.
 * "không năm" → "05", "bốn mươi lăm" → "45", "một bốn" → "14". Không nhận hàng nghìn
 * ("hai phẩy năm triệu" là 2,5 triệu, không phải 2,5000000).
 */
export function parseFractionalWords(words: Words, i: number): ParsedDigits | null {
  let k = i;
  let digits = '';
  while (words[k] === 'không') {
    digits += '0';
    k += 1;
  }
  const chunk = parseChunk(words, k, false);
  if (chunk) {
    digits += String(chunk.value);
    k = chunk.end;
  }
  // Chữ số đọc rời phía sau. "không" chỉ nhận khi còn chữ số theo sau, tránh nuốt
  // "không" hỏi ("hai phẩy năm không?").
  for (;;) {
    const word = words[k];
    const digit = DIGIT_VALUES.get(word ?? '');
    if (digit === undefined || digits === '') break;
    if (digit === 0 && !isDigitWord(words[k + 1])) break;
    digits += String(digit);
    k += 1;
  }
  return digits === '' ? null : { digits, end: k };
}

/** Đọc mẫu số sau "phần": số nguyên, "tư" (= 4), "nghìn"/"ngàn" (= 1000). "trăm" là phần trăm, không xử lý ở đây. */
export function parseDenominatorWords(words: Words, i: number): ParsedNumber | null {
  const word = words[i];
  if (word === 'tư') return { value: 4, end: i + 1 };
  if (word === 'nghìn' || word === 'ngàn') return { value: 1000, end: i + 1 };
  return parseIntegerWords(words, i);
}
