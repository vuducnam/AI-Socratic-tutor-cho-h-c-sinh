import { describe, expect, it } from 'vitest';
import { tutorConversationMessages } from './tutor-conversation-messages';

describe('tutorConversationMessages', () => {
  it('lượt mở bài chỉ có câu hook: thêm dòng hệ thống ở đầu và cuối, không kết thúc bằng assistant', () => {
    const m = tutorConversationMessages([{ role: 'assistant', content: 'Hôm qua con đi chợ với mẹ à?' }], null);
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('lịch sử rỗng vẫn có một tin user', () => {
    expect(tutorConversationMessages([], null)).toEqual([{ role: 'user', content: '[Hệ thống] Bắt đầu bài.' }]);
  });

  it('lịch sử đã kết thúc bằng lời con thì giữ nguyên, phản hồi bị chặn nối sau cùng', () => {
    const history = [
      { role: 'user' as const, content: 'con chào Cú' },
      { role: 'assistant' as const, content: 'Con thấy số nào lớn hơn?' },
      { role: 'user' as const, content: '0,45' },
    ];
    expect(tutorConversationMessages(history, null)).toEqual(history);
    const m = tutorConversationMessages(history, 'lộ đáp án');
    expect(m).toHaveLength(4);
    expect(m.at(-1)!.content).toContain('lộ đáp án');
  });
});
