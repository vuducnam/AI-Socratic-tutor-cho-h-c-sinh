import 'server-only';

// Gemini TTS qua OpenRouter chỉ trả PCM thô (`audio/pcm;rate=24000;channels=1`, 16-bit little-endian). Trình duyệt
// không phát được PCM thô, nên bọc thêm header WAV (không nén lại, không cần ffmpeg trong container app).

export interface PcmFormat {
  sampleRate: number;
  channels: number;
}

/** Đọc rate/channels từ content-type PCM; null nếu không phải PCM hoặc tham số không hợp lệ. */
export function parsePcmContentType(contentType: string): PcmFormat | null {
  const [type, ...params] = contentType.split(';').map((p) => p.trim().toLowerCase());
  if (type !== 'audio/pcm' && type !== 'audio/l16') return null;
  const value = (name: string) => params.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);
  const sampleRate = Number(value('rate') ?? 24000);
  const channels = Number(value('channels') ?? 1);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) return null;
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) return null;
  return { sampleRate, channels };
}

/** Bọc PCM 16-bit vào WAV (RIFF, PCM format 1). */
export function pcmToWav(pcm: Buffer, format: PcmFormat): Buffer {
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * format.channels * bytesPerSample, 28);
  header.writeUInt16LE(format.channels * bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
