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
});
