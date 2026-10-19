// Chuẩn hoá phần toán gõ bằng bàn phím (chữ số + ký hiệu) về dạng viết chuẩn.
// Dùng chung cho toCanonical, toSpoken và toMachine để cả ba hiểu cùng một cách viết.
//
// Quy ước:
// - Dấu thập phân là dấu phẩy, dính liền hai phía ("0,45"). Dấu phẩy có khoảng trắng phía sau là dấu câu.
// - Dấu chấm theo quy ước Việt Nam: "1.000" / "2.500.000" là phân cách hàng nghìn; "0.45", "3.5", "12.75"
//   (không đúng dạng nhóm 3 chữ số) là thập phân kiểu bàn phím Anh → đổi sang dấu phẩy.
// - Số nguyên chuẩn không có dấu phân cách: "1 000 000" và "1.000.000" → "1000000".
// - Phép tính giữa hai số: "3 × 4", "3 : 4" (dấu chia lớp 5), "3 + 4", "3 − 4", "3 = 4", "3 < 4".
//   Dấu "-" và "–" chỉ được hiểu là trừ khi có khoảng trắng hai bên ("2-3 lần" là khoảng, giữ nguyên).
//   "8:30" (giờ:phút, không khoảng trắng) giữ nguyên.

import { POWERED_LENGTH_SYMBOL_PATTERN, UNIT_SYMBOL_PATTERN } from './vietnamese-math-units';

/** Toán hạng dạng chuẩn: số nguyên, thập phân, phân số, phần trăm. */
export const CANONICAL_OPERAND_PATTERN = String.raw`\d+(?:,\d+)?(?:\/\d+)?%?`;

const DOTTED_NUMBER_RE = /(?<![\d.,])\d+(?:\.\d+)+/g;
const THOUSANDS_DOTTED_RE = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const SPACE_GROUPED_RE = /(?<![\d,.\/])[1-9]\d{0,2}(?:[    ]\d{3})+(?!\d)/g;
const GROUP_SEPARATOR_RE = /[    ]/g;
const POWERED_UNIT_RE = new RegExp(
  String.raw`(\d)[  ]?(${POWERED_LENGTH_SYMBOL_PATTERN})([23])(?![\p{L}\p{N}])`,
  'gu',
);
const GLUED_UNIT_RE = new RegExp(String.raw`(\d)(${UNIT_SYMBOL_PATTERN})(?![\p{L}\p{N}])`, 'gu');
const PERCENT_SPACE_RE = /(\d)[  ]+%/g;
const FRACTION_SPACE_RE = /(?<![\d,\/])(\d+)[  ]*\/[  ]*(\d+)(?![\d,\/])/g;
const BINARY_OPERATOR_RE = new RegExp(
  String.raw`(?<![\d,\/])(${CANONICAL_OPERAND_PATTERN})(\s*)([×*xX÷:+=<>−\-–])(\s*)(?=(${CANONICAL_OPERAND_PATTERN}))`,
  'g',
);
const TIME_HOUR_RE = /^\d{1,2}$/;
const TIME_MINUTE_RE = /^[0-5]\d$/;

const CANONICAL_OPERATOR = new Map<string, string>([
  ['×', '×'], ['*', '×'], ['x', '×'], ['X', '×'],
  [':', ':'], ['÷', ':'],
  ['+', '+'], ['=', '='], ['<', '<'], ['>', '>'],
  ['−', '−'], ['-', '−'], ['–', '−'],
]);

const SUPERSCRIPT = new Map([['2', '²'], ['3', '³']]);

function convertDottedNumber(match: string): string {
  if (THOUSANDS_DOTTED_RE.test(match)) return match.replace(/\./g, '');
  const dotCount = match.split('.').length - 1;
  // Nhiều dấu chấm mà không đúng nhóm nghìn (ngày "19.10.2026", phiên bản) → không phải số, giữ nguyên.
  return dotCount === 1 ? match.replace('.', ',') : match;
}

function convertBinaryOperator(
  match: string,
  left: string,
  spaceBefore: string,
  operator: string,
  spaceAfter: string,
  right: string,
): string {
  const spaced = spaceBefore.length > 0 && spaceAfter.length > 0;
  if ((operator === '-' || operator === '–') && !spaced) return match;
  if (operator === ':' && !spaceBefore && !spaceAfter && TIME_HOUR_RE.test(left) && TIME_MINUTE_RE.test(right)) {
    return match;
  }
  const canonical = CANONICAL_OPERATOR.get(operator);
  return canonical === undefined ? match : `${left} ${canonical} `;
}

/**
 * Số con gõ dấu chấm làm dấu thập phân ("2.5", "0.45"): normalizeTypedMath vẫn hiểu đúng (đổi sang phẩy),
 * hàm này chỉ trả các chỗ đó để Cú nhắc nhẹ con viết dấu phẩy. "2.500" (nhóm nghìn) không tính.
 */
export function findDotDecimals(text: string): string[] {
  return [...text.normalize('NFC').matchAll(DOTTED_NUMBER_RE)]
    .map((m) => m[0])
    .filter((m) => !THOUSANDS_DOTTED_RE.test(m) && m.split('.').length === 2);
}

/** Chuẩn hoá phần chữ số + ký hiệu; chữ (kể cả số đọc bằng chữ) giữ nguyên. Hàm idempotent. */
export function normalizeTypedMath(text: string): string {
  return text
    .normalize('NFC')
    .replace(DOTTED_NUMBER_RE, convertDottedNumber)
    .replace(SPACE_GROUPED_RE, (m) => m.replace(GROUP_SEPARATOR_RE, ''))
    .replace(POWERED_UNIT_RE, (_m, digit: string, unit: string, power: string) => {
      return `${digit} ${unit}${SUPERSCRIPT.get(power) ?? power}`;
    })
    .replace(GLUED_UNIT_RE, '$1 $2')
    .replace(PERCENT_SPACE_RE, '$1%')
    .replace(FRACTION_SPACE_RE, '$1/$2')
    .replace(BINARY_OPERATOR_RE, (match: string, left: string, sb: string, op: string, sa: string, right: string) =>
      convertBinaryOperator(match, left, sb, op, sa, right),
    );
}
