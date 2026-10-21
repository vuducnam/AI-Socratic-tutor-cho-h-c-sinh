import { describe, expect, it } from 'vitest';
import { foldTones, matchedFactIds, matchedPhrase, normalizeForMatch } from './key-point-matcher';

// Code quyết định con đã nêu ý chính nào (SPEC §5d): khớp nguyên cụm, chịu được cách bỏ dấu và gõ thiếu dấu thanh.

const DBP = { fact_id: 'B15.F1', accept: ['điện biên phủ'] };
const YEAR = { fact_id: 'B15.F2', accept: ['1954', 'năm 1954'] };
const SEA = { fact_id: 'B3.F1', accept: ['quần đảo hoàng sa'] };

describe('key-point-matcher', () => {
  it('chuẩn hoá chữ hoa, dấu câu, gạch nối', () => {
    expect(normalizeForMatch('  Chiến dịch ĐIỆN-BIÊN-PHỦ, năm 1954! ')).toBe('chiến dịch điện biên phủ năm 1954');
    expect(foldTones('thuỷ lợi')).toBe(foldTones('thủy lợi'));
    expect(foldTones('thế kỉ')).toBe(foldTones('thế kỷ'));
  });

  it('nhận câu trả lời đúng, kể cả cách bỏ dấu khác và gõ thiếu dấu thanh', () => {
    expect(matchedFactIds('Chiến thắng Điện Biên Phủ vào năm 1954', [DBP, YEAR, SEA])).toEqual(['B15.F1', 'B15.F2']);
    expect(matchedPhrase('dien bien phu', DBP)).toBeNull(); // bỏ cả dấu chữ (ê) thì không nhận: tránh nhầm từ
    expect(matchedPhrase('điên biên phu', DBP)).toBe('điện biên phủ');
    expect(matchedPhrase('Quần đảo Hoàng Sa của Việt Nam', SEA)).toBe('quần đảo hoàng sa');
  });

  it('khớp nguyên cụm theo ranh giới chữ, không khớp một phần từ hay số dài hơn', () => {
    expect(matchedPhrase('năm 19545', YEAR)).toBeNull();
    expect(matchedPhrase('ví dụ', { fact_id: 'x', accept: ['dụ'] })).toBe('dụ'); // "dụ" là một từ trong "ví dụ"
    expect(matchedPhrase('dụ cần vương', { fact_id: 'x', accept: ['dụ cần vương'] })).toBe('dụ cần vương');
    expect(matchedPhrase('hoàng sa', SEA)).toBeNull();
  });
});
