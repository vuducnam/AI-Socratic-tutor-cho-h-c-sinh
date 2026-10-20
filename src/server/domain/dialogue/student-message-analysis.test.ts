import { describe, expect, it } from 'vitest';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { relationClaim } from './relation-claim';
import { answerMatchesFinal, looksLikeExplanation, stepsCompletedBy } from './student-message-analysis';

// Câu thật của học sinh giả trong eval (đề so sánh 0,45 và 0,5; đáp án 0,5 > 0,45).
const comparePlan = {
  steps: [],
  final_answer: { value: '0,45 < 0,5', canonical: '<', kind: 'relation', choice_label: null },
  skill_ids: [],
  misconception_ids: [],
  sympy_check: { kind: 'relation', expression: '0.45 < 0.5', expected: '<' },
  given_numbers: ['0,45', '0,5'],
} as unknown as SolutionPlan;

describe('relationClaim / answerMatchesFinal (so sánh)', () => {
  it('khẳng định sai không được coi là khớp đáp án, dù cuối câu có chữ "nhỏ hơn"', () => {
    const text = 'Chắc 0,45 lớn hơn vì có 45 mà 5 thì nhỏ hơn... mà mình không chắc.';
    expect(relationClaim(text, '0.5', '0.45')).toBe('wrong');
    expect(answerMatchesFinal(text, comparePlan)).toBe(false);
  });

  it('các cách nói đúng', () => {
    for (const text of ['0,5 lớn hơn 0,45', '0,45 bé hơn 0,5 ạ', '0,45 < 0,5', 'Số lớn hơn là 0,5', '0,5 lớn hơn', 'không phẩy năm lớn hơn không phẩy bốn mươi lăm']) {
      expect(answerMatchesFinal(text, comparePlan), text).toBe(true);
    }
  });

  it('chỉ nói một số: đúng khi là số lớn hơn và không kèm so sánh', () => {
    expect(answerMatchesFinal('0,5', comparePlan)).toBe(true);
    expect(answerMatchesFinal('0,45', comparePlan)).toBe(false);
  });

  it('đổi ý trong cùng tin mà còn một khẳng định sai → chưa khớp', () => {
    expect(answerMatchesFinal('0,45 lớn hơn. À không, 0,5 lớn hơn', comparePlan)).toBe(false);
  });
});

// Đề viết 3 7/100 thành số thập phân (đáp án 3,07).
const mixedPlan = {
  steps: [{ step_id: 's1', skill_id: 'x', description: 'đổi 7/100', expected_result: '7/100 = 0,07', hint_question: '?' }],
  final_answer: { value: '3,07', canonical: '3.07', kind: 'number', choice_label: null },
  skill_ids: ['x'],
  misconception_ids: [],
  sympy_check: { kind: 'number', expression: '3 + 7/100', expected: '3.07' },
  given_numbers: ['3', '7/100'],
} as unknown as SolutionPlan;

describe('answerMatchesFinal (số)', () => {
  it('nói đúng đáp án, kèm số trong đề hoặc kết quả bước → khớp', () => {
    expect(answerMatchesFinal('3,07', mixedPlan)).toBe(true);
    expect(answerMatchesFinal('7/100 là 0,07 nên viết 3,07', mixedPlan)).toBe(true);
  });

  it('liệt kê nhiều đáp án để đoán → chưa khớp', () => {
    const text = 'Hình như là 3,7 phải không Mít? À mà không, hay là 3,07? Hay là 3,007 hả Mít?';
    expect(answerMatchesFinal(text, mixedPlan)).toBe(false);
  });

  it('số trung gian trong lời giải thích không bị coi là đoán', () => {
    const text = 'Vì 1 chia thành 100 phần bằng nhau thì mỗi phần là 0,01, lấy 7 phần là 0,07, ghép với 3 thành 3,07.';
    expect(answerMatchesFinal(text, mixedPlan)).toBe(true);
  });
});

// Đề Mai cắt ruy băng 10 đoạn, lấy 3 đoạn (bước s1 = 3/10, đáp án 0,3).
const ribbonPlan = {
  steps: [
    { step_id: 's1', skill_id: 'x', description: 'viết phân số', expected_result: '3/10', hint_question: '?' },
    { step_id: 's2', skill_id: 'x', description: 'đổi ra số thập phân', expected_result: '0,3', hint_question: '?' },
  ],
  final_answer: { value: '0,3', canonical: '0.3', kind: 'number', choice_label: null },
  skill_ids: ['x'],
  misconception_ids: [],
  sympy_check: { kind: 'number', expression: '3/10', expected: '0.3' },
  given_numbers: ['10', '3'],
} as unknown as SolutionPlan;

describe('stepsCompletedBy', () => {
  it('nói kết quả bước → xong bước', () => {
    expect(stepsCompletedBy('Là 3/10 đó Mít', ribbonPlan, [])).toEqual(['s1']);
  });

  it('đoán giữa hai phương án → chưa xong bước, chưa khớp đáp án', () => {
    const text = 'Ừm... 3/10 hả Mít? Hay là 10/3 nhỉ? Tớ đoán 3/10 đó. Vậy là 0,3 đúng không?';
    expect(stepsCompletedBy(text, ribbonPlan, [])).toEqual([]);
    expect(answerMatchesFinal(text, ribbonPlan)).toBe(false);
  });
});

describe('looksLikeExplanation', () => {
  it('có lý do → là giải thích', () => {
    expect(looksLikeExplanation('Vì 0,5 có 5 phần mười, còn 0,45 chỉ có 4 phần mười')).toBe(true);
    expect(looksLikeExplanation('Lúc nãy mình tưởng số dài hơn là to hơn')).toBe(true);
  });

  it('con tự nói đoán / đang rối, hoặc không có lý do → chưa phải giải thích', () => {
    expect(looksLikeExplanation('Ơ mình đoán thôi mà, thấy có số 3 với số 10 nên ghép lại thành 0,3')).toBe(false);
    expect(looksLikeExplanation('Số 4 đứng ngay sau dấu phẩy, là hàng phần mười đúng không Mít? Mình hơi rối rồi.')).toBe(false);
    expect(looksLikeExplanation('Dạ mình làm xong rồi đó Mít')).toBe(false);
  });
});
