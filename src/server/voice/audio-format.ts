import 'server-only';

// Định dạng audio của đoạn ghi âm: Content-Type do client gửi chỉ dùng để lọc sớm; định dạng thật lấy
// theo magic bytes (không tin đuôi file hay Content-Type), giống cách xử lý ảnh đề.

/**
 * MIME (bỏ tham số như `;codecs=opus`) mà route /api/stt nhận — khớp đúng các định dạng stt-local giải mã
 * được (services/stt-local/app/audio_decode.py). Không nhận mp3: trình duyệt không ghi mp3 và stt-local
 * không có demuxer mp3, nhận vào chỉ để rồi local từ chối.
 */
export const ALLOWED_AUDIO_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4'] as const;

/** Tên định dạng theo `input_audio.format` của OpenRouter. */
export type AudioFormat = 'webm' | 'ogg' | 'wav' | 'm4a';

export const AUDIO_FORMAT_MIME: Record<AudioFormat, string> = {
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/** `audio/webm;codecs=opus` → `audio/webm`; MIME ngoài danh sách → null. */
export function baseAudioMime(mimeType: string): string | null {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(base) ? base : null;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

export function detectAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'; // EBML (WebM/Matroska)
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'ogg'; // "OggS"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x41, 0x56, 0x45], 8)) return 'wav'; // RIFF…WAVE
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) return 'm4a'; // ISO BMFF "ftyp"
  return null;
}
