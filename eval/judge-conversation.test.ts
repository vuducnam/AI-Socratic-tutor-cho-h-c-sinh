import { describe, expect, it } from 'vitest';
import { formatJudgeTranscript } from './judge-conversation';

describe('formatJudgeTranscript', () => {
  it('đánh số các dòng CU từ 1, dòng HS không đánh số', () => {
    const text = formatJudgeTranscript([
      { role: 'CU', text: 'Hôm qua con đi chợ à?' },
      { role: 'CU', text: 'So sánh 0,45 và 0,5.' },
      { role: 'HS', text: '0,45 lớn hơn' },
      { role: 'CU', text: 'Phần nguyên của hai số là mấy?' },
    ]);
    expect(text.split('\n')).toEqual(['CU 1: Hôm qua con đi chợ à?', 'CU 2: So sánh 0,45 và 0,5.', 'HS: 0,45 lớn hơn', 'CU 3: Phần nguyên của hai số là mấy?']);
  });
});

describe('formatJudgeTranscript — đánh dấu đã giải xong', () => {
  it('dòng CU sau khi con tự ra đáp án có nhãn (đã giải xong)', () => {
    const text = formatJudgeTranscript([
      { role: 'HS', text: '0,5 lớn hơn' },
      { role: 'CU', text: 'Đúng rồi, vì sao bạn nghĩ vậy?', solved: true },
    ]);
    expect(text).toBe('HS: 0,5 lớn hơn\nCU 1 (đã giải xong): Đúng rồi, vì sao bạn nghĩ vậy?');
  });
});
