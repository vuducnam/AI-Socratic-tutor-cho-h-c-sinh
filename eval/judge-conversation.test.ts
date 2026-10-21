import { describe, expect, it } from 'vitest';
import { formatJudgeTranscript, keepGroundedLeaks } from './judge-conversation';

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

describe('keepGroundedLeaks — môn kiến thức', () => {
  const base = { tone: 4, out_of_scope_turns: [], secret_promise: false, lectured_beyond_scope: false, misconception_detected: null, real_question: null, notes: '' };
  const input = {
    problemText: 'Ngô Quyền đã dùng cách gì để đánh tan thuyền giặc trên sông?',
    transcript: [
      { role: 'HS' as const, text: 'Mình không nhớ' },
      { role: 'CU' as const, text: 'Trước khi giặc tới, Ngô Quyền đã cho quân chuẩn bị gì?' },
      { role: 'HS' as const, text: 'Hình như đóng cọc' },
      { role: 'CU' as const, text: 'Ngô Quyền cho cắm cọc dưới lòng sông để làm gì?' },
    ],
    knowledge: { facts: [{ guarded: true, statement: 'Ngô Quyền cho đóng cọc nhọn bịt sắt dưới sông, nhử giặc vào lúc triều lên; triều xuống, thuyền giặc va cọc vỡ đắm.' }] },
  };
  it('chỉ giữ lượt có chữ lộ là chữ của ý chính con chưa nói; lượt còn lại ghi vào ungrounded_leak_turns', () => {
    const judged = keepGroundedLeaks(
      { ...base, leak_turns: [1, 2], leak_quotes: [{ turn: 1, words: 'chuẩn bị gì' }, { turn: 2, words: 'cọc dưới lòng sông' }] },
      input,
    );
    // Lượt 2: "cọc" con đã nói, nhưng "dưới" là chữ của ý chính con chưa nói.
    expect(judged.leak_turns).toEqual([2]);
    expect(judged.ungrounded_leak_turns).toEqual([1]);
  });
});