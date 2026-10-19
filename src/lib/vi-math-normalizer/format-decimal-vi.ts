// Hiển thị số theo quy ước Việt Nam: dấu thập phân là dấu phẩy, không phân cách hàng nghìn.
// Dùng ở UI để "0.45" không bao giờ lọt ra màn hình học sinh.

const MACHINE_DECIMAL_RE = /^-?\d+(?:[.,]\d+)?$/;
const EXPONENT_RE = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i;

/** Viết lại dạng mũ của JS ("1e-7", "1.5e+21") thành dạng thập phân đầy đủ. */
function expandExponent(text: string): string {
  const m = EXPONENT_RE.exec(text);
  if (!m) return text;
  const [, sign = '', integerPart = '', fractionalPart = '', exponentText = '0'] = m;
  const digits = integerPart + fractionalPart;
  const point = integerPart.length + Number(exponentText);
  let body: string;
  if (point <= 0) body = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) body = digits + '0'.repeat(point - digits.length);
  else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + body.replace(/^0+(?=\d)/, '');
}

/**
 * Hiển thị số với dấu phẩy thập phân: 0.45 → "0,45", "12.5" → "12,5", -3 → "-3".
 * Chuỗi đầu vào phải ở dạng máy ("0.45") hoặc đã dùng dấu phẩy ("0,45"); không nhận phân cách hàng nghìn.
 * Ném RangeError với NaN/Infinity, TypeError với chuỗi không phải số.
 */
export function formatDecimalVi(value: number | string): string {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Không hiển thị được số không hữu hạn: ${value}`);
    text = Object.is(value, -0) ? '0' : expandExponent(String(value));
  } else {
    text = value.trim();
    if (!MACHINE_DECIMAL_RE.test(text)) throw new TypeError(`Không phải số thập phân hợp lệ: "${value}"`);
  }
  return text.replace('.', ',');
}
