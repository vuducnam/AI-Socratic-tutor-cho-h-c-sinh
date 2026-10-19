import 'server-only';

// Số học chính xác bằng phân số BigInt cho việc điền biến (không dùng float: 0,1 + 0,2 phải ra 0,3).
// Chỉ hỗ trợ + - * / ngoặc, số thập phân dấu chấm và tên biến — đủ cho answer_expression của thư viện.

export class Fraction {
  constructor(readonly n: bigint, readonly d: bigint) {
    if (d === 0n) throw new Error('chia cho 0');
  }

  static of(text: string): Fraction {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
    if (!m) throw new Error(`không phải số: ${text}`);
    const frac = m[3] ?? '';
    const n = BigInt(`${m[2]}${frac}`) * (m[1] ? -1n : 1n);
    return new Fraction(n, 10n ** BigInt(frac.length)).reduce();
  }

  static ofNumber(value: number): Fraction {
    return Fraction.of(Number(value.toFixed(10)).toString());
  }

  reduce(): Fraction {
    const g = gcd(this.n < 0n ? -this.n : this.n, this.d);
    const sign = this.d < 0n ? -1n : 1n;
    return g === 0n ? this : new Fraction((this.n / g) * sign, (this.d / g) * sign);
  }

  add(o: Fraction) {
    return new Fraction(this.n * o.d + o.n * this.d, this.d * o.d).reduce();
  }
  sub(o: Fraction) {
    return new Fraction(this.n * o.d - o.n * this.d, this.d * o.d).reduce();
  }
  mul(o: Fraction) {
    return new Fraction(this.n * o.n, this.d * o.d).reduce();
  }
  div(o: Fraction) {
    if (o.n === 0n) throw new Error('chia cho 0');
    return new Fraction(this.n * o.d, this.d * o.n).reduce();
  }
  compare(o: Fraction): number {
    const diff = this.n * o.d - o.n * this.d;
    return diff === 0n ? 0 : diff > 0n ? 1 : -1;
  }

  /** Số chữ số thập phân nếu là số thập phân hữu hạn, ngược lại null. */
  decimalPlaces(): number | null {
    let d = this.d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    return d === 1n ? Math.max(twos, fives) : null;
  }

  /** Dạng máy dấu chấm, bỏ 0 thừa (chỉ khi hữu hạn). */
  toDecimalString(): string {
    const places = this.decimalPlaces();
    if (places === null) return `${this.n}/${this.d}`;
    const scaled = (this.n * 10n ** BigInt(places)) / this.d;
    const neg = scaled < 0n;
    const digits = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
    const int = digits.slice(0, digits.length - places);
    const frac = places ? digits.slice(-places).replace(/0+$/, '') : '';
    return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Tính biểu thức với biến; parser đệ quy đơn giản (không eval). */
export function evaluateExpression(expression: string, vars: Record<string, Fraction>): Fraction {
  const tokens = expression.match(/\d+(?:\.\d+)?|[a-z][a-z0-9_]*|[-+*/()]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s+/g, '')) throw new Error(`biểu thức có ký tự lạ: ${expression}`);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): Fraction => {
    const t = next();
    if (t === undefined) throw new Error('biểu thức thiếu');
    if (t === '(') {
      const v = sum();
      if (next() !== ')') throw new Error('thiếu )');
      return v;
    }
    if (t === '-') return new Fraction(0n, 1n).sub(primary());
    if (/^\d/.test(t)) return Fraction.of(t);
    const v = vars[t];
    if (!v) throw new Error(`biến chưa có giá trị: ${t}`);
    return v;
  };
  const product = (): Fraction => {
    let v = primary();
    while (peek() === '*' || peek() === '/') v = next() === '*' ? v.mul(primary()) : v.div(primary());
    return v;
  };
  const sum = (): Fraction => {
    let v = product();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v.add(product()) : v.sub(product());
    return v;
  };
  const result = sum();
  if (i !== tokens.length) throw new Error(`biểu thức dư: ${expression}`);
  return result;
}

/** Điều kiện dạng "a > b", "a != b", "a + b <= 10". */
export function evaluateCondition(condition: string, vars: Record<string, Fraction>): boolean {
  const m = /^(.+?)(<=|>=|!=|==|<|>)(.+)$/.exec(condition.replace(/\s+/g, ''));
  if (!m) throw new Error(`điều kiện không hợp lệ: ${condition}`);
  const c = evaluateExpression(m[1]!, vars).compare(evaluateExpression(m[3]!, vars));
  switch (m[2]) {
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '>=': return c >= 0;
    case '==': return c === 0;
    default: return c !== 0;
  }
}
