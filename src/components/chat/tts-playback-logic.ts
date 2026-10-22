// Logic thuần cho nút "nghe" và tự đọc lời Mít (không phụ thuộc React, test được trong Node).
import type { ChatLine } from './chat-types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chỉ lượt thật của Mít (id lượt trong DB, dạng UUID) mới đọc được qua /api/tts.
 * Dòng thông báo do client tự tạo (id "r-…", kind "notice") không phải lượt nên không có nút nghe.
 */
export function isSpeakableLine(line: ChatLine): boolean {
  return line.from === 'cu' && line.kind !== 'notice' && UUID_RE.test(line.turnId) && line.text.trim().length > 0;
}

export function speakableTurnIds(lines: readonly ChatLine[]): string[] {
  return lines.filter(isSpeakableLine).map((l) => l.turnId);
}

/** Lượt mới cần tự đọc: chưa từng tự đọc và không bị server báo không có tiếng. Giữ thứ tự hiển thị. */
export function pickAutoplayIds(ids: readonly string[], alreadyPlayed: ReadonlySet<string>, unavailable: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (alreadyPlayed.has(id) || unavailable.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * WAV PCM 8-bit mono toàn im lặng, dạng data URI. Phát nó trong lần chạm đầu tiên để "mở khoá" thẻ <audio>
 * (Safari/iPadOS chỉ cho tự phát trên phần tử đã từng được phát nhờ thao tác của người dùng).
 */
export function silentWavDataUri(sampleCount = 160, sampleRate = 8000): string {
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // kích thước khối fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte/giây = sampleRate × 1 kênh × 1 byte
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bit/mẫu
  ascii(36, 'data');
  view.setUint32(40, sampleCount, true);
  bytes.fill(128, 44); // 128 = im lặng với PCM 8-bit không dấu
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}
