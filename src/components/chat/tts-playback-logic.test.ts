import { describe, expect, it } from 'vitest';
import type { ChatLine } from './chat-types';
import { isSpeakableLine, pickAutoplayIds, silentWavDataUri, speakableTurnIds } from './tts-playback-logic';

const ID_A = '0b6f1c7e-2a4d-4c1b-9a77-1d2e3f4a5b6c';
const ID_B = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const line = (over: Partial<ChatLine>): ChatLine => ({ turnId: ID_A, from: 'cu', text: 'Bạn thử đếm lại nhé?', kind: 'normal', ...over });

describe('isSpeakableLine', () => {
  it('lượt thật của Mít (id UUID) có nút nghe, kể cả câu mở chuyện đời', () => {
    expect(isSpeakableLine(line({}))).toBe(true);
    expect(isSpeakableLine(line({ kind: 'hook' }))).toBe(true);
  });

  it('tin của con, thông báo do client tạo, id tạm hoặc chữ rỗng → không có nút nghe', () => {
    expect(isSpeakableLine(line({ from: 'student' }))).toBe(false);
    expect(isSpeakableLine(line({ kind: 'notice' }))).toBe(false);
    expect(isSpeakableLine(line({ turnId: 'r-1729500000000' }))).toBe(false);
    expect(isSpeakableLine(line({ text: '  ' }))).toBe(false);
  });

  it('speakableTurnIds giữ thứ tự hiển thị', () => {
    const lines = [line({ turnId: ID_B, kind: 'hook' }), line({ from: 'student', turnId: 's-x' }), line({ turnId: ID_A })];
    expect(speakableTurnIds(lines)).toEqual([ID_B, ID_A]);
  });
});

describe('pickAutoplayIds', () => {
  it('mỗi lượt chỉ tự đọc một lần, bỏ lượt server báo không có tiếng, bỏ trùng', () => {
    expect(pickAutoplayIds([ID_A, ID_B, ID_A], new Set(), new Set())).toEqual([ID_A, ID_B]);
    expect(pickAutoplayIds([ID_A, ID_B], new Set([ID_A]), new Set())).toEqual([ID_B]);
    expect(pickAutoplayIds([ID_A, ID_B], new Set(), new Set([ID_B]))).toEqual([ID_A]);
  });
});

describe('silentWavDataUri', () => {
  it('là WAV PCM 8-bit mono hợp lệ, toàn im lặng', () => {
    const uri = silentWavDataUri(100, 8000);
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(uri.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const ascii = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(bytes.length).toBe(144);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(136);
    expect(ascii(8, 8)).toBe('WAVEfmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(8);
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(100);
    expect(bytes.slice(44).every((b) => b === 128)).toBe(true);
  });
});
