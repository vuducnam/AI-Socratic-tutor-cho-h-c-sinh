import { describe, expect, it } from 'vitest';
import { draftCandidates, mergeLeadingInterjection } from './tutor-draft-candidates';

describe('mergeLeadingInterjection', () => {
  it('gộp câu cảm thán ngắn đứng đầu khi tin thừa câu', () => {
    expect(mergeLeadingInterjection('Đúng rồi! Bạn tự nối 3 phần mười với chữ số 3. Vì sao 6 lại đứng sau?', 2)).toBe(
      'Đúng rồi, bạn tự nối 3 phần mười với chữ số 3. Vì sao 6 lại đứng sau?',
    );
  });

  it('giữ chữ hoa của tên riêng sau khi gộp', () => {
    expect(mergeLeadingInterjection('Chào Minh! Minh đọc đề rồi. Đề hỏi gì nhỉ?', 2)).toBe('Chào Minh, Minh đọc đề rồi. Đề hỏi gì nhỉ?');
  });

  it('không đổi khi tin không thừa câu hoặc câu đầu không phải cảm thán ngắn', () => {
    expect(mergeLeadingInterjection('Đúng rồi! Vì sao 6 lại đứng sau?', 2)).toBe('Đúng rồi! Vì sao 6 lại đứng sau?');
    const long = 'Bạn đã làm rất cẩn thận từng bước! Bạn nối 3 với phần mười. Vì sao 6 đứng sau?';
    expect(mergeLeadingInterjection(long, 2)).toBe(long);
  });
});

describe('draftCandidates', () => {
  it('bản chính trước, bản ngắn sau, bỏ trùng và bỏ bản rỗng', () => {
    expect(draftCandidates({ message: 'A dài?', short_message: 'A?' }, 2)).toEqual(['A dài?', 'A?']);
    expect(draftCandidates({ message: 'A?', short_message: 'A?' }, 2)).toEqual(['A?']);
    expect(draftCandidates({ message: 'A?', short_message: '' }, 2)).toEqual(['A?']);
  });
});
