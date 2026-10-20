import { describe, expect, it } from 'vitest';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { relationClaim } from './relation-claim';
import { answerMatchesFinal, looksLikeExplanation } from './student-message-analysis';

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
