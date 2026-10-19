// toCanonical: lời nói / chữ gõ tiếng Việt về toán → dạng viết chuẩn.
// "không phẩy bốn mươi lăm" → "0,45"; "một phần ba" → "1/3"; "ba nhân bốn" → "3 × 4";
// "năm mươi phần trăm" → "50%"; "ba xăng-ti-mét vuông" → "3 cm²"; "0.45" → "0,45".
//
// Để không làm hỏng chữ thường, một chữ số đứng một mình ("ba", "năm", "không", "một") chỉ được đổi
// khi là toán hạng của phép tính ("ba nhân bốn") hoặc có đơn vị / phần trăm / phân số / phẩy đi kèm.
// "con không biết", "ba ơi", "năm nay", "một bạn" giữ nguyên. Cụm số nhiều từ ("hai mươi lăm",
// "một trăm") và "mười" luôn được đổi. Phép tính chỉ được đổi khi hai bên đều là số.

import { normalizeTypedMath } from './normalize-typed-math';
import {
  parseDenominatorWords,
  parseFractionalWords,
  parseIntegerWords,
} from './parse-vietnamese-number-words';
import { MAX_UNIT_WORDS, compactUnitWords, unitSymbolFromCompact } from './vietnamese-math-units';

type ItemKind = 'num' | 'word' | 'other';

interface Item {
  text: string;
  /** Khoảng trắng gốc đứng trước, giữ nguyên khi không đổi gì. */
  sepBefore: string;
  kind: ItemKind;
}

interface Operand {
  text: string;
  end: number;
  /** Có phần nào được đọc từ chữ (chỉ khi đó mới cần viết lại). */
  fromWords: boolean;
  /** Đủ chắc là số để đổi kể cả khi không nằm trong phép tính. */
  strong: boolean;
}

interface Operator {
  symbol: string;
  end: number;
  fromWords: boolean;
}

const TOKEN_RE = /(\d+(?:,\d+)?(?:\/\d+)?%?)|([\p{L}\p{M}²³]+(?:-[\p{L}\p{M}²³]+)*)|(\s+)|([\s\S])/gu;
const INTEGER_RE = /^\d+$/;

/** Thứ tự quan trọng: cụm dài ("cộng với") đứng trước cụm ngắn ("cộng"). */
const OPERATOR_PHRASES: ReadonlyArray<readonly [readonly string[], string]> = [
  [['cộng', 'với'], '+'],
  [['cộng'], '+'],
  [['trừ', 'đi'], '−'],
  [['trừ'], '−'],
  [['nhân', 'với'], '×'],
  [['nhân'], '×'],
  [['chia', 'cho'], ':'],
  [['chia'], ':'],
  [['bằng'], '='],
  [['bé', 'hơn'], '<'],
  [['nhỏ', 'hơn'], '<'],
  [['lớn', 'hơn'], '>'],
];

/** Ký hiệu phép tính gõ lẫn với số đọc bằng chữ ("ba × bốn"); phải có khoảng trắng hai bên. */
const SYMBOL_OPERATORS = new Map<string, string>([
  ['×', '×'], ['*', '×'], [':', ':'], ['÷', ':'], ['+', '+'],
  ['−', '−'], ['-', '−'], ['=', '='], ['<', '<'], ['>', '>'],
]);

function tokenize(text: string): { items: Item[]; trailing: string } {
  const items: Item[] = [];
  let pending = '';
  for (const m of text.matchAll(TOKEN_RE)) {
    const [whole, num, word, space] = m;
    if (space !== undefined) {
      pending += space;
      continue;
    }
    const kind: ItemKind = num !== undefined ? 'num' : word !== undefined ? 'word' : 'other';
    items.push({ text: whole, sepBefore: pending, kind });
    pending = '';
  }
  return { items, trailing: pending };
}

class CanonicalParser {
  private readonly words: string[];

  constructor(private readonly items: readonly Item[]) {
    this.words = items.map((item) => item.text.toLowerCase());
  }

  private plainIntegerAt(k: number): string | undefined {
    const item = this.items[k];
    return item?.kind === 'num' && INTEGER_RE.test(item.text) ? item.text : undefined;
  }

  private matchUnit(k: number): { symbol: string; end: number } | null {
    for (let n = MAX_UNIT_WORDS; n >= 1; n--) {
      const slice = this.items.slice(k, k + n);
      if (slice.length < n || slice.some((item) => item.kind !== 'word')) continue;
      const symbol = unitSymbolFromCompact(compactUnitWords(slice.map((item) => item.text).join('')));
      if (symbol !== undefined) return { symbol, end: k + n };
    }
    return null;
  }

  parseOperand(i: number): Operand | null {
    const item = this.items[i];
    if (!item || item.kind === 'other') return null;
    const words = this.words;
    let text: string;
    let k: number;
    let fromWords = false;
    let strong = false;

    if (item.kind === 'num') {
      text = item.text;
      k = i + 1;
    } else {
      // "phần mười" không có tử số đứng trước là tên hàng ("hàng phần mười"), không phải số 10.
      // Có tử số ("ba phần mười") thì toán hạng bắt đầu từ tử số nên không tới nhánh này.
      if (words[i - 1] === 'phần' && this.items[i - 1]?.kind === 'word') return null;
      const parsed = parseIntegerWords(words, i);
      if (!parsed) return null;
      text = String(parsed.value);
      k = parsed.end;
      fromWords = true;
      strong = parsed.end - i >= 2 || words[i] === 'mười';
    }
    let isPlainInteger = INTEGER_RE.test(text);

    if (isPlainInteger && words[k] === 'phẩy') {
      const typed = this.plainIntegerAt(k + 1);
      const fraction = typed !== undefined ? { digits: typed, end: k + 2 } : parseFractionalWords(words, k + 1);
      if (fraction) {
        text = `${text},${fraction.digits}`;
        k = fraction.end;
        fromWords = strong = true;
        isPlainInteger = false;
      }
    }

    if (!/[%/]/.test(text) && words[k] === 'phần' && words[k + 1] === 'trăm') {
      return { text: `${text}%`, end: k + 2, fromWords: true, strong: true };
    }

    if (isPlainInteger && words[k] === 'phần') {
      const typed = this.plainIntegerAt(k + 1);
      const den = typed !== undefined ? { value: typed, end: k + 2 } : parseDenominatorWords(words, k + 1);
      if (den) {
        text = `${text}/${den.value}`;
        k = den.end;
        fromWords = strong = true;
      }
    }

    if (!text.endsWith('%')) {
      const unit = this.matchUnit(k);
      if (unit) {
        text = `${text} ${unit.symbol}`;
        k = unit.end;
        fromWords = strong = true;
      }
    }
    return { text, end: k, fromWords, strong };
  }

  parseOperator(k: number): Operator | null {
    const item = this.items[k];
    if (!item) return null;
    if (item.kind === 'other') {
      const symbol = SYMBOL_OPERATORS.get(item.text);
      const next = this.items[k + 1];
      if (symbol !== undefined && item.sepBefore !== '' && next !== undefined && next.sepBefore !== '') {
        return { symbol, end: k + 1, fromWords: false };
      }
      return null;
    }
    for (const [phrase, symbol] of OPERATOR_PHRASES) {
      if (phrase.every((w, offset) => this.items[k + offset]?.kind === 'word' && this.words[k + offset] === w)) {
        return { symbol, end: k + phrase.length, fromWords: true };
      }
    }
    return null;
  }
}

/** Đổi lời nói / chữ gõ về dạng viết chuẩn. Phần không phải toán giữ nguyên (kể cả khoảng trắng). */
export function toCanonical(text: string): string {
  const { items, trailing } = tokenize(normalizeTypedMath(text));
  const parser = new CanonicalParser(items);
  let out = '';
  const emitRaw = (from: number, to: number) => {
    for (const item of items.slice(from, to)) out += item.sepBefore + item.text;
  };

  let i = 0;
  while (i < items.length) {
    const first = parser.parseOperand(i);
    if (!first) {
      emitRaw(i, i + 1);
      i += 1;
      continue;
    }
    let expression = first.text;
    let end = first.end;
    let fromWords = first.fromWords;
    let operatorCount = 0;
    for (;;) {
      const operator = parser.parseOperator(end);
      if (!operator) break;
      const operand = parser.parseOperand(operator.end);
      if (!operand) break;
      expression += ` ${operator.symbol} ${operand.text}`;
      end = operand.end;
      fromWords = fromWords || operator.fromWords || operand.fromWords;
      operatorCount += 1;
    }

    const rewrite = operatorCount > 0 ? fromWords : first.strong && first.fromWords;
    if (rewrite) out += (items[i]?.sepBefore ?? '') + expression;
    else emitRaw(i, end);
    i = end;
  }
  return out + trailing;
}
