// toSpoken: dạng viết → lời đọc cho TTS.
// "0,45" → "không phẩy bốn mươi lăm"; "3/4" → "ba phần tư"; "cm²" → "xăng-ti-mét vuông";
// "m³" → "mét khối"; "×" → "nhân"; "3 : 4" → "ba chia bốn"; "50%" → "năm mươi phần trăm".
// Văn bản được chuẩn hoá phần gõ phím trước (normalizeTypedMath) nên "0.45", "3*4" cũng đọc đúng.

import { normalizeTypedMath } from './normalize-typed-math';
import { STANDALONE_UNIT_SYMBOL_PATTERN, UNIT_SYMBOL_PATTERN, spokenUnit } from './vietnamese-math-units';
import { decimalToWords, fractionToWords } from './vietnamese-number-words';

/**
 * Số (phân số | số nguyên/thập phân kèm % tuỳ chọn), kèm đơn vị tuỳ chọn ngay sau.
 * Không bắt đầu giữa một số hoặc sau "/" (ngày "19/10/2026" không bị đọc thành phân số ở đoạn sau).
 */
const NUMBER_RE = new RegExp(
  String.raw`(?<![\d\/])(?:(\d+)\/(\d+)(?![\d\/])|(\d+)(?:,(\d+))?(%)?)(?:[  ]?(${UNIT_SYMBOL_PATTERN})(?![\p{L}\p{N}]))?`,
  'gu',
);
const STANDALONE_UNIT_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${STANDALONE_UNIT_SYMBOL_PATTERN})(?![\p{L}\p{N}])`,
  'gu',
);

/** Ký hiệu chỉ dùng trong toán: đọc ở mọi vị trí. */
const ALWAYS_SPOKEN_OPERATORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[  ]*×[  ]*/g, ' nhân '],
  [/[  ]*−[  ]*/g, ' trừ '],
  [/[  ]*÷[  ]*/g, ' chia '],
  [/[  ]*=[  ]*/g, ' bằng '],
];

/** Ký hiệu cũng là dấu câu ("Bài 1:"): chỉ đọc khi có khoảng trắng hai bên, đúng dạng chuẩn của phép tính. */
const SPACED_OPERATORS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[  ]+:[  ]+/g, ' chia '],
  [/[  ]+\+[  ]+/g, ' cộng '],
  [/[  ]+-[  ]+/g, ' trừ '],
  [/[  ]+<[  ]+/g, ' bé hơn '],
  [/[  ]+>[  ]+/g, ' lớn hơn '],
];

function speakNumber(
  _match: string,
  numerator: string | undefined,
  denominator: string | undefined,
  integerPart: string | undefined,
  fractionalPart: string | undefined,
  percent: string | undefined,
  unit: string | undefined,
): string {
  const parts: string[] = [];
  if (numerator !== undefined && denominator !== undefined) parts.push(fractionToWords(numerator, denominator));
  else if (integerPart !== undefined) parts.push(decimalToWords(integerPart, fractionalPart));
  if (percent) parts.push('phần trăm');
  if (unit) parts.push(spokenUnit(unit) ?? unit);
  return parts.join(' ');
}

/** Đổi dạng viết sang lời đọc. Chữ thường giữ nguyên. */
export function toSpoken(text: string): string {
  let spoken = normalizeTypedMath(text).replace(NUMBER_RE, speakNumber);
  spoken = spoken.replace(STANDALONE_UNIT_RE, (symbol: string) => spokenUnit(symbol) ?? symbol);
  for (const [pattern, words] of [...ALWAYS_SPOKEN_OPERATORS, ...SPACED_OPERATORS]) {
    spoken = spoken.replace(pattern, words);
  }
  return spoken;
}
