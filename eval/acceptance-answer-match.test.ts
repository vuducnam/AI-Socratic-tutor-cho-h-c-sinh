import { describe, expect, it } from 'vitest';
import { presolveAnswerMatches } from './acceptance-answer-match';

describe('presolveAnswerMatches', () => {
  it('số so theo giá trị, bỏ qua số 0 thừa ở cuối', () => {
    expect(presolveAnswerMatches({ canonical: '9.4', kind: 'number', choice_label: null }, { display: '9,4', machine: ['9.40'] })).toBe(true);
    expect(presolveAnswerMatches({ canonical: '375.4', kind: 'number', choice_label: null }, { display: '375,4', machine: ['375.400'] })).toBe(true);
    expect(presolveAnswerMatches({ canonical: '9.5', kind: 'number', choice_label: null }, { display: '9,4', machine: ['9.40'] })).toBe(false);
  });

  it('danh sách số giữ đúng thứ tự', () => {
    const list = { display: '0,3; 0,325', machine: ['0.3', '0.325'] };
    expect(presolveAnswerMatches({ canonical: ['0.30', '0.325'], kind: 'number_list', choice_label: null }, list)).toBe(true);
    expect(presolveAnswerMatches({ canonical: ['0.325', '0.3'], kind: 'number_list', choice_label: null }, list)).toBe(false);
  });

  it('lựa chọn so theo nhãn', () => {
    const expected = { display: 'Hoa (2,9 m)', machine: ['2.9'] };
    expect(presolveAnswerMatches({ canonical: '1', kind: 'choice', choice_label: 'Hoa' }, expected)).toBe(true);
    expect(presolveAnswerMatches({ canonical: '0', kind: 'choice', choice_label: 'An' }, expected)).toBe(false);
    expect(presolveAnswerMatches({ canonical: '1', kind: 'choice', choice_label: null }, expected)).toBe(false);
  });
});
