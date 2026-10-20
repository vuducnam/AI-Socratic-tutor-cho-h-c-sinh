import { describe, expect, it } from 'vitest';
import { stateGuidance } from './tutor-prompt';

describe('stateGuidance', () => {
  it('không đoán bừa → chỉ dẫn theo trạng thái', () => {
    expect(stateGuidance('PROBE')).toBe('hỏi để em giải thích cách nghĩ của mình; không gợi ý cách làm');
  });

  it('đoán bừa → thêm chỉ dẫn hỏi em vì sao chọn đáp án, giữ chỉ dẫn trạng thái', () => {
    const text = stateGuidance('SCAFFOLD', { guessing: true });
    expect(text.startsWith('gợi ý nhỏ theo bậc')).toBe(true);
    expect(text).toContain('hỏi em vì sao chọn đáp án đó');
  });

  it('dấu chấm thập phân → nhắc dùng dấu phẩy, ghép được với đoán bừa', () => {
    const text = stateGuidance('PROBE', { guessing: true, dotDecimal: true });
    expect(text).toContain('hỏi em vì sao chọn đáp án đó');
    expect(text).toContain('dùng dấu phẩy');
  });

  it('CONSOLIDATE mà con đoán / chưa chắc → chưa xác nhận đúng, hỏi lý do trước', () => {
    for (const hints of [{ unsure: true }, { guessing: true }]) {
      const text = stateGuidance('CONSOLIDATE', hints);
      expect(text).toContain('CHƯA nói đúng hay sai');
      expect(text).not.toContain('"Đúng rồi,"');
    }
    expect(stateGuidance('CONSOLIDATE')).toContain('"Đúng rồi,"');
  });
});

describe('planFallbackQuestion', () => {
  it('CONSOLIDATE dùng câu hỏi củng cố, không quay lại gợi ý bước đầu', async () => {
    const { CONSOLIDATE_FALLBACK, planFallbackQuestion } = await import('./fallback-question');
    const plan = { steps: [{ step_id: 's1', hint_question: 'Câu gợi ý bước 1?' }] } as unknown as Parameters<typeof planFallbackQuestion>[0];
    expect(planFallbackQuestion(plan, 's1', 'CONSOLIDATE')).toBe(CONSOLIDATE_FALLBACK);
    expect(planFallbackQuestion(plan, 's1', 'SCAFFOLD')).toBe('Câu gợi ý bước 1?');
  });

  it('DONE dùng câu chào cuối, không phải câu hỏi', async () => {
    const { DONE_MESSAGE, planFallbackQuestion } = await import('./fallback-question');
    expect(planFallbackQuestion(null, null, 'DONE')).toBe(DONE_MESSAGE);
    expect(DONE_MESSAGE).not.toContain('?');
  });
});
