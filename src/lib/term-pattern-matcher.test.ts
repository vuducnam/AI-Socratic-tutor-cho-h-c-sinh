import { describe, expect, it } from 'vitest';
import { compileTermPattern, findTermMatches, InvalidTermPatternError, normalizeForMatching } from './term-pattern-matcher';

const terms = (...patterns: string[]) => [{ term: 't', patterns }];

describe('term-pattern-matcher', () => {
  it('chuẩn hoá NFC, chữ thường, gộp khoảng trắng', () => {
    expect(normalizeForMatching('  Số   THẬP\nphân ')).toBe('số thập phân');
    // NFD (dấu tách rời) vẫn khớp với pattern NFC.
    expect(findTermMatches('so sánh hai số thập phân', terms('số thập phân'))).toHaveLength(1);
  });

  it('chỉ khớp nguyên từ theo ranh giới Unicode, không dùng \\b', () => {
    expect(findTermMatches('phân số này', terms('phân'))).toHaveLength(1);
    expect(findTermMatches('phân số', terms('phân s'))).toHaveLength(0);
    expect(findTermMatches('chánh văn phòng', terms('chán'))).toHaveLength(0);
    expect(findTermMatches('số âm', terms('âm'))).toHaveLength(1);
    expect(findTermMatches('âm thanh', terms('âm'))).toHaveLength(1);
    expect(findTermMatches('thâm', terms('âm'))).toHaveLength(0);
  });

  it('khoảng trắng trong pattern khớp mọi khoảng trắng', () => {
    expect(findTermMatches('tỉ   số phần trăm', terms('tỉ số phần trăm'))).toHaveLength(1);
  });

  it('ký hiệu không cần ranh giới chữ: "%" khớp trong "50%"', () => {
    expect(findTermMatches('giảm 50% giá', terms('%'))).toHaveLength(1);
  });

  it('"phần trăm" đơn lẻ không bị chặn khi chỉ cấm "tỉ số phần trăm"', () => {
    expect(findTermMatches('bốn mươi lăm phần trăm', terms('tỉ số phần trăm'))).toHaveLength(0);
  });

  it('re: dùng regex; regex hỏng → lỗi rõ ràng', () => {
    expect(findTermMatches('hàng phần mười', terms('re:hàng\\s+phần\\s+(mười|trăm)'))).toHaveLength(1);
    expect(() => compileTermPattern('re:(abc')).toThrow(InvalidTermPatternError);
    expect(() => compileTermPattern('re:')).toThrow(InvalidTermPatternError);
  });

  it('pattern có ký tự đặc biệt regex được escape', () => {
    expect(findTermMatches('x (y) z', terms('(y)'))).toHaveLength(1);
    expect(findTermMatches('a.b', terms('a.b'))).toHaveLength(1);
    expect(findTermMatches('axb', terms('a.b'))).toHaveLength(0);
  });

  it('trả về mọi lần khớp theo thứ tự xuất hiện', () => {
    const found = findTermMatches('ẩn số và ẩn số', [
      { term: 'ẩn', patterns: ['ẩn số'] },
    ]);
    expect(found.map((f) => f.index)).toEqual([0, 9]);
  });
});
