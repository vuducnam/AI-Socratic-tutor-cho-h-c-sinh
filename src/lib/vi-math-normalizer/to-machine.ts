// toMachine: biểu thức số học dạng chuẩn → chuỗi cho sympy (math-verifier).
// "0,45" → "0.45"; "1/3" → "Rational(1,3)"; "3 × 4" → "3*4"; "3 : 4" → "3/4"; "50%" → "Rational(50,100)".
// Chỉ nhận số học: số, + − × :, phân số, phần trăm, ngoặc đơn. Mọi thứ khác (chữ, đơn vị, "=", "<")
// ném UnsupportedMathExpressionError để nơi gọi xử lý rõ ràng thay vì gửi chuỗi sai sang sympy.
// Lưu ý: số thập phân ra dạng "0.45" (theo SPEC); phía Python nên sympify với rational=True nếu cần chính xác.

import { normalizeTypedMath } from './normalize-typed-math';

export type UnsupportedMathReason = 'empty' | 'unsupported_token' | 'syntax' | 'division_by_zero';

export class UnsupportedMathExpressionError extends Error {
  override readonly name = 'UnsupportedMathExpressionError';

  constructor(
    readonly reason: UnsupportedMathReason,
    readonly input: string,
    message: string,
  ) {
    super(message);
  }
}

type Token =
  | { type: 'number'; machine: string; isZero: boolean }
  | { type: 'operator'; op: '+' | '-' | '*' | '/' }
  | { type: 'open' }
  | { type: 'close' };

const TOKEN_RE = /\s+|(\d+)\/(\d+)(?!\d)|(\d+)(?:,(\d+))?(%?)|([+\-−×*:÷\/()])/y;

const OPERATOR_MAP = new Map<string, '+' | '-' | '*' | '/'>([
  ['+', '+'], ['-', '-'], ['−', '-'], ['×', '*'], ['*', '*'], [':', '/'], ['÷', '/'], ['/', '/'],
]);

/** Python không nhận số nguyên có số 0 đứng đầu ("05"). */
function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

function tokenize(source: string, input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    TOKEN_RE.lastIndex = index;
    const m = TOKEN_RE.exec(source);
    if (!m || m[0] === '') {
      throw new UnsupportedMathExpressionError(
        'unsupported_token',
        input,
        `Ký tự không hỗ trợ tại vị trí ${index}: "${source.slice(index, index + 10)}"`,
      );
    }
    index = TOKEN_RE.lastIndex;
    const [, numerator, denominator, integerPart, fractionalPart, percent, symbol] = m;
    if (numerator !== undefined && denominator !== undefined) {
      if (/^0+$/.test(denominator)) {
        throw new UnsupportedMathExpressionError('division_by_zero', input, `Phân số có mẫu bằng 0: ${m[0]}`);
      }
      const machine = `Rational(${stripLeadingZeros(numerator)},${stripLeadingZeros(denominator)})`;
      tokens.push({ type: 'number', machine, isZero: /^0+$/.test(numerator) });
    } else if (integerPart !== undefined) {
      const fraction = fractionalPart ?? '';
      const isZero = /^0+$/.test(integerPart + fraction);
      let machine: string;
      if (percent) {
        machine = `Rational(${stripLeadingZeros(integerPart + fraction)},1${'0'.repeat(fraction.length + 2)})`;
      } else {
        machine = fraction ? `${stripLeadingZeros(integerPart)}.${fraction}` : stripLeadingZeros(integerPart);
      }
      tokens.push({ type: 'number', machine, isZero });
    } else if (symbol === '(') {
      tokens.push({ type: 'open' });
    } else if (symbol === ')') {
      tokens.push({ type: 'close' });
    } else if (symbol !== undefined) {
      const op = OPERATOR_MAP.get(symbol);
      if (op) tokens.push({ type: 'operator', op });
    }
  }
  return tokens;
}

/** Phân tích đệ quy để chắc biểu thức đúng cú pháp trước khi gửi sang sympy. */
class MachineExpressionParser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly input: string,
  ) {}

  parse(): string {
    const result = this.expression();
    if (this.position < this.tokens.length) this.fail('Thừa ký hiệu ở cuối biểu thức');
    return result;
  }

  private fail(message: string): never {
    throw new UnsupportedMathExpressionError('syntax', this.input, message);
  }

  private peekOperator(...ops: string[]): '+' | '-' | '*' | '/' | null {
    const token = this.tokens[this.position];
    return token?.type === 'operator' && ops.includes(token.op) ? token.op : null;
  }

  private expression(): string {
    let out = this.term();
    for (let op = this.peekOperator('+', '-'); op; op = this.peekOperator('+', '-')) {
      this.position += 1;
      out += op + this.term();
    }
    return out;
  }

  private term(): string {
    let out = this.factor();
    for (let op = this.peekOperator('*', '/'); op; op = this.peekOperator('*', '/')) {
      this.position += 1;
      const divisor = this.tokens[this.position];
      if (op === '/' && divisor?.type === 'number' && divisor.isZero) {
        throw new UnsupportedMathExpressionError('division_by_zero', this.input, 'Chia cho 0');
      }
      out += op + this.factor();
    }
    return out;
  }

  private factor(): string {
    const token = this.tokens[this.position];
    if (!token) return this.fail('Biểu thức kết thúc giữa chừng');
    if (token.type === 'operator' && token.op === '-') {
      this.position += 1;
      return `-${this.factor()}`;
    }
    if (token.type === 'open') {
      this.position += 1;
      const inner = this.expression();
      if (this.tokens[this.position]?.type !== 'close') this.fail('Thiếu dấu đóng ngoặc');
      this.position += 1;
      return `(${inner})`;
    }
    if (token.type === 'number') {
      this.position += 1;
      return token.machine;
    }
    return this.fail('Thiếu số ở vị trí cần số');
  }
}

/** Đổi biểu thức số học dạng chuẩn sang chuỗi sympy. Ném UnsupportedMathExpressionError nếu không hỗ trợ. */
export function toMachine(text: string): string {
  const source = normalizeTypedMath(text).trim();
  if (source === '') throw new UnsupportedMathExpressionError('empty', text, 'Biểu thức rỗng');
  return new MachineExpressionParser(tokenize(source, text), text).parse();
}
