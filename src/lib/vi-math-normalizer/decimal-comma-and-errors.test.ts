import { describe, expect, it } from 'vitest';
import {
  UnsupportedMathExpressionError,
  formatDecimalVi,
  integerToWords,
  toCanonical,
  toMachine,
  toSpoken,
} from './index';

describe('dấu phẩy thập phân và dấu phẩy câu', () => {
  it('"0,45, 0,5 và 0,6" giữ đúng ba số', () => {
    const text = '0,45, 0,5 và 0,6';
    expect(toCanonical(text)).toBe(text);
    expect(toSpoken(text)).toBe('không phẩy bốn mươi lăm, không phẩy năm và không phẩy sáu');
    expect(toSpoken(text).split(',')).toHaveLength(2);
  });

  it('dấu phẩy có khoảng trắng phía sau là dấu câu', () => {
    expect(toSpoken('1, 5')).toBe('một, năm');
    expect(toCanonical('một, năm')).toBe('một, năm');
    expect(toSpoken('Số 3, số 4')).toBe('Số ba, số bốn');
  });

  it('dấu chấm cuối câu không bị nhầm là dấu thập phân', () => {
    expect(toCanonical('So sánh 0,45 và 0,5.')).toBe('So sánh 0,45 và 0,5.');
    expect(toCanonical('Kết quả là 0.5.')).toBe('Kết quả là 0,5.');
    expect(toSpoken('So sánh 0,45 và 0,5.')).toBe('So sánh không phẩy bốn mươi lăm và không phẩy năm.');
  });

  it('lời đọc nhiều số thập phân ngăn bởi dấu phẩy câu về đúng từng số', () => {
    expect(toCanonical('không phẩy bốn mươi lăm, không phẩy năm, không phẩy sáu')).toBe('0,45, 0,5, 0,6');
  });

  it('không bao giờ sinh dấu chấm thập phân', () => {
    for (const input of ['0.45', 'không phẩy bốn mươi lăm', '3.5 × 2', '12.75%']) {
      expect(toCanonical(input)).not.toMatch(/\d\.\d/);
    }
  });
});

describe('toMachine báo lỗi có kiểu', () => {
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['3 cm', 'unsupported_token'],
    ['3 + 4 = 7', 'unsupported_token'],
    ['3 < 4', 'unsupported_token'],
    ['x + 3', 'unsupported_token'],
    ['3, 4', 'unsupported_token'],
    ['3 +', 'syntax'],
    ['(3 + 4', 'syntax'],
    ['3 + 4)', 'syntax'],
    ['3 4', 'syntax'],
    ['× 3', 'syntax'],
    ['1/0', 'division_by_zero'],
    ['5 : 0', 'division_by_zero'],
    ['5 : 0,0', 'division_by_zero'],
  ];

  it.each(cases)('"%s" → %s', (input, reason) => {
    let caught: unknown;
    try {
      toMachine(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedMathExpressionError);
    expect((caught as UnsupportedMathExpressionError).reason).toBe(reason);
    expect((caught as UnsupportedMathExpressionError).input).toBe(input);
  });
});

describe('formatDecimalVi', () => {
  it.each([
    [0.45, '0,45'],
    [12.5, '12,5'],
    [-3, '-3'],
    [-0, '0'],
    [1000000, '1000000'],
    [1e-7, '0,0000001'],
    [1.5e21, '1500000000000000000000'],
    ['0.45', '0,45'],
    ['0,45', '0,45'],
    [' 7 ', '7'],
  ] as const)('%s → "%s"', (input, expected) => {
    expect(formatDecimalVi(input)).toBe(expected);
  });

  it('từ chối giá trị không phải số', () => {
    expect(() => formatDecimalVi(Number.NaN)).toThrow(RangeError);
    expect(() => formatDecimalVi(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatDecimalVi('abc')).toThrow(TypeError);
    expect(() => formatDecimalVi('1.000.000')).toThrow(TypeError);
    expect(() => formatDecimalVi('')).toThrow(TypeError);
  });
});

describe('integerToWords', () => {
  it('đọc từng chữ số khi có số 0 đứng đầu hoặc quá dài', () => {
    expect(integerToWords('05')).toBe('không năm');
    expect(integerToWords('1234567890123')).toBe('một hai ba bốn năm sáu bảy tám chín không một hai ba');
  });

  it('từ chối chuỗi không phải chữ số', () => {
    expect(() => integerToWords('12a')).toThrow(TypeError);
    expect(() => integerToWords('')).toThrow(TypeError);
  });
});
