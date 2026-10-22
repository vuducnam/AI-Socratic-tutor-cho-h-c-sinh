import { describe, expect, it } from 'vitest';
import { nameInitial } from './message-list';

// Vòng tròn biểu tượng của con trong luồng chat: chữ cái đầu tên gọi, viết hoa đúng tiếng Việt.
describe('nameInitial', () => {
  it('lấy chữ cái đầu, viết hoa, giữ dấu tiếng Việt', () => {
    expect(nameInitial('Na')).toBe('N');
    expect(nameInitial('  đức')).toBe('Đ');
    expect(nameInitial('ánh')).toBe('Á');
  });

  it('tên trống → "B" (bạn)', () => {
    expect(nameInitial('')).toBe('B');
    expect(nameInitial('   ')).toBe('B');
  });
});
