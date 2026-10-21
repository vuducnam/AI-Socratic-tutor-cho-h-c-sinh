import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STT_PIECES, normalizeTranscript, rawSttFromPieces, signSttReceipt } from './stt-receipt';

// Biên nhận STT: chỉ chữ server đã nghe (đúng học sinh, đúng phiên, đúng từng ký tự) mới thành raw_stt.

const who = { studentId: 'student-a', sessionId: 'session-1' };
const piece = (text: string, owner = who) => ({ text, receipt: signSttReceipt({ ...owner, text }) });

beforeEach(() => vi.stubEnv('SESSION_SECRET', 'test-session-secret-0123456789'));
afterEach(() => vi.unstubAllEnvs());

describe('rawSttFromPieces', () => {
  it('ghép các đoạn hợp lệ bằng khoảng trắng, cắt theo giới hạn', () => {
    expect(rawSttFromPieces({ ...who, pieces: [piece('ba phần'), piece('tư')], maxChars: 2000 })).toBe('ba phần tư');
    expect(rawSttFromPieces({ ...who, pieces: [piece('a'.repeat(30))], maxChars: 10 })).toBe('a'.repeat(10));
  });

  it('một đoạn sai (chữ sửa, học sinh khác, phiên khác, biên nhận rác) → null cả tin', () => {
    const edited = { ...piece('không phẩy năm'), text: 'không phẩy sáu' };
    const otherStudent = piece('x', { studentId: 'student-b', sessionId: 'session-1' });
    const otherSession = piece('x', { studentId: 'student-a', sessionId: 'session-2' });
    for (const bad of [edited, otherStudent, otherSession, { text: 'x', receipt: '' }, { text: 'x', receipt: '!!' }]) {
      expect(rawSttFromPieces({ ...who, pieces: [piece('đúng'), bad], maxChars: 2000 })).toBeNull();
    }
  });

  it('không có đoạn hoặc quá số đoạn → null', () => {
    expect(rawSttFromPieces({ ...who, pieces: undefined, maxChars: 2000 })).toBeNull();
    expect(rawSttFromPieces({ ...who, pieces: [], maxChars: 2000 })).toBeNull();
    const many = Array.from({ length: MAX_STT_PIECES + 1 }, () => piece('a'));
    expect(rawSttFromPieces({ ...who, pieces: many, maxChars: 2000 })).toBeNull();
  });

  it('thiếu SESSION_SECRET → lỗi cấu hình, không ký bằng khoá rỗng', () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => signSttReceipt({ ...who, text: 'x' })).toThrow('SESSION_SECRET');
  });
});

describe('normalizeTranscript', () => {
  it('gộp khoảng trắng và xuống dòng', () => {
    expect(normalizeTranscript('  không phẩy\n\tbốn  ')).toBe('không phẩy bốn');
  });
});
