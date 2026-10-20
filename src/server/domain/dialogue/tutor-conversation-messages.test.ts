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

  it('lịch sử đã kết thúc bằng lời con thì giữ nguyên', () => {
    const history = [
      { role: 'user' as const, content: 'con chào Cú' },
      { role: 'assistant' as const, content: 'Con thấy số nào lớn hơn?' },
      { role: 'user' as const, content: '0,45' },
    ];
    expect(tutorConversationMessages(history, null)).toEqual(history);
  });

  it('bản nháp bị chặn được gửi kèm để Tutor sửa, lý do chặn nằm ở tin cuối', () => {
    const history = [{ role: 'user' as const, content: '0,45' }];
    const m = tutorConversationMessages(history, { message: 'Một câu quá dài.', feedback: 'LENGTH (41 từ > 35)' });
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(m[1]!.content).toContain('Một câu quá dài.');
    expect(m.at(-1)!.content).toContain('41 từ > 35');
  });

  it('lượt mở bài bị chặn: vẫn xen kẽ đúng và kết thúc bằng user', () => {
    const m = tutorConversationMessages([{ role: 'assistant', content: 'Câu hook.' }], { message: 'Nháp.', feedback: 'LEAK' });
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });
});
