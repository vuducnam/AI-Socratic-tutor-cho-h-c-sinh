import { describe, expect, it } from 'vitest';
import type { SolutionPlan } from '@/server/domain/presolve/plan-schema';
import { factsBeyondQuestion, keyPointsProgress, statedTimeline, withheldPhrases } from './key-points-progress';

// Code chấm câu trả lời môn kiến thức (SPEC §5d): cộng dồn qua các lượt, không tính lời nhắc lại đề.

const FACTS = [
  { fact_id: 'B15.F1', accept: ['điện biên phủ', 'tây bắc'] },
  { fact_id: 'B15.F2', accept: ['13 – 3 – 1954', 'ngày 13 tháng 3', '13 3 1954'] },
  { fact_id: 'B15.F3', accept: ['7 – 5 – 1954', 'ngày 7 tháng 5', '7 5 1954'] },
  { fact_id: 'B15.F4', accept: ['phan đình giót'] },
];
const plan = (k: Partial<NonNullable<SolutionPlan['knowledge']>>): SolutionPlan => ({
  steps: [
    { step_id: 's1', skill_id: 'HG.B15', description: 'Ngày bắt đầu', expected_result: '13 – 3 – 1954', hint_question: 'Chiến dịch mở màn khi nào?', fact_ids: ['B15.F2'] },
    { step_id: 's2', skill_id: 'HG.B15', description: 'Ngày kết thúc', expected_result: '7 – 5 – 1954', hint_question: 'Kết thúc khi nào?', fact_ids: ['B15.F3'] },
  ],
  final_answer: { value: 'Từ 13 – 3 đến 7 – 5 – 1954', canonical: ['B15.F2', 'B15.F3'], kind: 'key_points', choice_label: null },
  skill_ids: ['HG.B15'],
  misconception_ids: [],
  sympy_check: null,
  given_numbers: [],
  knowledge: { question_type: 'fact', required_fact_ids: ['B15.F2', 'B15.F3'], min_required: 2, context_fact_ids: ['B15.F4'], ...k },
});
const QUESTION = 'Chiến dịch Điện Biên Phủ diễn ra từ ngày nào đến ngày nào?';

describe('key-points-progress', () => {
  it('cụm có sẵn trong câu hỏi không còn là cụm chấm', () => {
    expect(factsBeyondQuestion(FACTS, QUESTION)[0]!.accept).toEqual(['tây bắc']);
  });

  it('cộng dồn qua các lượt: đủ hai ý bắt buộc mới là trả lời được; bước xong theo ý', () => {
    const one = keyPointsProgress({ plan: plan({}), facts: FACTS, problemText: QUESTION, studentTexts: ['Bắt đầu ngày 13 tháng 3 năm 1954'] });
    expect(one).toEqual({ statedFactIds: ['B15.F2'], completedSteps: ['s1'], answered: false });
    const two = keyPointsProgress({ plan: plan({}), facts: FACTS, problemText: QUESTION, studentTexts: ['Bắt đầu ngày 13 tháng 3 năm 1954', 'kết thúc ngày 7 tháng 5'] });
    expect(two).toMatchObject({ statedFactIds: ['B15.F2', 'B15.F3'], completedSteps: ['s1', 's2'], answered: true });
  });

  it('nhắc lại đề không tính là đã nêu ý; câu ý kiến không bao giờ "trả lời xong" bằng code', () => {
    expect(keyPointsProgress({ plan: plan({}), facts: FACTS, problemText: QUESTION, studentTexts: ['Điện Biên Phủ ạ?'] }).statedFactIds).toEqual([]);
    const opinion = plan({ question_type: 'opinion', required_fact_ids: [], min_required: 0 });
    expect(keyPointsProgress({ plan: opinion, facts: FACTS, problemText: QUESTION, studentTexts: ['Em thích Phan Đình Giót'] })).toMatchObject({
      statedFactIds: ['B15.F4'],
      answered: false,
    });
  });

  it('Mít không được nói cụm của ý bắt buộc con chưa nêu; ý đã nêu thì được nhắc lại', () => {
    expect(withheldPhrases({ plan: plan({}), facts: FACTS, problemText: QUESTION, statedFactIds: ['B15.F2'] })).toEqual([
      { fact_id: 'B15.F3', phrases: ['7 – 5 – 1954', 'ngày 7 tháng 5', '7 5 1954'] },
    ]);
  });
});

describe('statedTimeline', () => {
  const facts = [
    { fact_id: 'A', statement: 'Cách mạng tháng Tám thành công năm 1945 trên cả nước.' },
    { fact_id: 'B', statement: 'Chiến dịch Điện Biên Phủ kết thúc năm 1954.' },
    { fact_id: 'C', statement: 'Chiến dịch Hồ Chí Minh toàn thắng năm 1975.' },
  ];
  it('chỉ vẽ mốc năm của ý con đã nêu, theo thứ tự năm; dưới hai mốc thì không vẽ', () => {
    expect(statedTimeline(facts, ['B'])).toBeNull();
    const t = statedTimeline(facts, ['C', 'A']);
    expect(t?.kind).toBe('timeline');
    expect(t?.items.map((i) => i.value)).toEqual([1945, 1975]);
    expect(t?.items[0]!.label).toBe('Cách mạng tháng Tám thành công…');
  });
});
