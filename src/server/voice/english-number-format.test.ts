import { describe, expect, it } from 'vitest';
import { toVietnameseNumberStyle } from './english-number-format';
import { parsePcmContentType, pcmToWav } from './pcm-to-wav';

describe('toVietnameseNumberStyle', () => {
  it('chữ STT tiếng Anh (câu thật từ whisper-large-v3-turbo) → dấu phẩy thập phân', () => {
    expect(toVietnameseNumberStyle('I think 0.5 is bigger than 0.45, because 5 tenths is more than 4 tenths.')).toBe(
      'I think 0,5 is bigger than 0,45, because 5 tenths is more than 4 tenths.',
    );
  });

  it('dấu phẩy tách nghìn → khoảng trắng; dấu chấm cuối câu giữ nguyên', () => {
    expect(toVietnameseNumberStyle('It is 1,000 metres, or 1,250.5 grams. Done.')).toBe('It is 1 000 metres, or 1 250,5 grams. Done.');
    expect(toVietnameseNumberStyle('3, 4 and 5.')).toBe('3, 4 and 5.');
  });
});

describe('pcmToWav', () => {
  it('content-type PCM của Gemini TTS (OpenRouter) → header WAV 24 kHz mono 16-bit', () => {
    const format = parsePcmContentType('audio/pcm;rate=24000;channels=1');
    expect(format).toEqual({ sampleRate: 24000, channels: 1 });
    const wav = pcmToWav(Buffer.alloc(480), format!);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(480);
    expect(wav.length).toBe(524);
  });

  it('không phải PCM → null', () => {
    expect(parsePcmContentType('audio/mpeg')).toBeNull();
    expect(parsePcmContentType('audio/pcm;rate=abc')).toBeNull();
  });
});
