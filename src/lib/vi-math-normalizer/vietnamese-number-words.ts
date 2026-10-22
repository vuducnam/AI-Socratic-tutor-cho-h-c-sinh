// Đọc số thành chữ tiếng Việt (chiều số → chữ), dùng cho toSpoken.
// Cách đọc sinh ra theo chuẩn phổ thông: "linh" (không dùng "lẻ"), "nghìn" (không dùng "ngàn"),
// "mốt" / "tư" / "lăm" sau "mươi", "lăm" sau "mười". Cách đọc vùng miền chỉ được chấp nhận ở chiều
// ngược lại (parse-vietnamese-number-words.ts).

/** Chữ số đọc chuẩn, chỉ số = giá trị. */
export const DIGIT_WORDS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'] as const;

/** Tên hàng theo nhóm 3 chữ số, từ thấp lên cao. */
const GROUP_NAMES = ['', 'nghìn', 'triệu', 'tỷ'] as const;

/** Số nguyên dài hơn ngưỡng này được đọc từng chữ số (vượt xa phạm vi phổ thông). */
export const MAX_INTEGER_DIGITS = GROUP_NAMES.length * 3;

/** Phần thập phân (sau các số 0 đứng đầu) dài hơn ngưỡng này được đọc từng chữ số: "3,1416" → "ba phẩy một bốn một sáu". */
const MAX_FRACTION_CHUNK_DIGITS = 3;

const DIGITS_ONLY = /^\d+$/;

function digitWord(d: number): string {
  const word = DIGIT_WORDS[d];
  if (word === undefined) throw new RangeError(`Chữ số không hợp lệ: ${d}`);
  return word;
}

function assertDigits(digits: string): void {
  if (!DIGITS_ONLY.test(digits)) throw new TypeError(`Chỉ nhận chuỗi chữ số, nhận được "${digits}"`);
}

/** Đọc từng chữ số: "05" → "không năm". */
export function digitsToWords(digits: string): string {
  assertDigits(digits);
  return [...digits].map((c) => digitWord(Number(c))).join(' ');
}

/**
 * Đọc một nhóm 3 chữ số. `full` = nhóm không đứng đầu số nên phải đọc đủ "không trăm", "linh":
 * 1 005 → "một nghìn không trăm linh năm".
 */
function readTriple(hundreds: number, tens: number, units: number, full: boolean): string[] {
  const words: string[] = [];
  const hasHundreds = full || hundreds > 0;
  if (hasHundreds) words.push(digitWord(hundreds), 'trăm');
  if (tens === 0) {
    if (units > 0) {
      if (hasHundreds) words.push('linh');
      words.push(digitWord(units));
    }
  } else if (tens === 1) {
    words.push('mười');
    if (units === 5) words.push('lăm');
    else if (units > 0) words.push(digitWord(units));
  } else {
    words.push(digitWord(tens), 'mươi');
    if (units === 1) words.push('mốt');
    else if (units === 4) words.push('tư');
    else if (units === 5) words.push('lăm');
    else if (units > 0) words.push(digitWord(units));
  }
  return words;
}

/**
 * Đọc số nguyên (chuỗi chữ số, không dấu phân cách): "2026" → "hai nghìn không trăm hai mươi sáu".
 * Số có số 0 đứng đầu ("05") hoặc dài hơn MAX_INTEGER_DIGITS được đọc từng chữ số.
 */
export function integerToWords(digits: string): string {
  assertDigits(digits);
  if (digits.length > 1 && digits.startsWith('0')) return digitsToWords(digits);
  if (digits.length > MAX_INTEGER_DIGITS) return digitsToWords(digits);
  if (/^0+$/.test(digits)) return digitWord(0);

  const padded = digits.padStart(Math.ceil(digits.length / 3) * 3, '0');
  const groupCount = padded.length / 3;
  const words: string[] = [];
  for (let g = 0; g < groupCount; g++) {
    const h = Number(padded[g * 3]);
    const t = Number(padded[g * 3 + 1]);
    const u = Number(padded[g * 3 + 2]);
    // Nhóm toàn 0 thì bỏ hẳn (kể cả tên hàng): 1 000 005 → "một triệu không trăm linh năm".
    if (h === 0 && t === 0 && u === 0) continue;
    words.push(...readTriple(h, t, u, words.length > 0));
    const groupName = GROUP_NAMES[groupCount - 1 - g];
    if (groupName) words.push(groupName);
  }
  return words.join(' ');
}

/**
 * Đọc phần thập phân: mỗi số 0 đứng đầu đọc là "không", phần còn lại đọc như số nguyên
 * (tối đa 3 chữ số, dài hơn thì đọc từng chữ số). "05" → "không năm", "45" → "bốn mươi lăm".
 */
export function fractionalDigitsToWords(digits: string): string {
  assertDigits(digits);
  const zeroCount = /^0*/.exec(digits)?.[0].length ?? 0;
  const rest = digits.slice(zeroCount);
  const words: string[] = Array.from({ length: zeroCount }, () => digitWord(0));
  if (rest.length > 0) {
    words.push(rest.length > MAX_FRACTION_CHUNK_DIGITS ? digitsToWords(rest) : integerToWords(rest));
  }
  return words.join(' ');
}

/** Đọc số thập phân viết bằng dấu phẩy: ("0", "45") → "không phẩy bốn mươi lăm". */
export function decimalToWords(integerPart: string, fractionalPart?: string): string {
  const intWords = integerToWords(integerPart);
  if (fractionalPart === undefined || fractionalPart === '') return intWords;
  return `${intWords} phẩy ${fractionalDigitsToWords(fractionalPart)}`;
}

/** Đọc phân số: "3/4" → "ba phần tư" (mẫu số đúng bằng 4 đọc là "tư"). */
export function fractionToWords(numerator: string, denominator: string): string {
  const denWords = denominator === '4' ? 'tư' : integerToWords(denominator);
  return `${integerToWords(numerator)} phần ${denWords}`;
}
