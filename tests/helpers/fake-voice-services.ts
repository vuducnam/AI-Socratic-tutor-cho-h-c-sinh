import { vi } from 'vitest';

// Giả lập stt-local và OpenRouter audio ở tầng HTTP (stub fetch toàn cục); code voice chạy thật, kể cả
// ghi llm_calls. Không gọi mạng.

export const STT_LOCAL_TEST_URL = 'http://stt-local.test';

export interface RecordedFetch {
  url: string;
  init: RequestInit;
}

type Handler = (call: RecordedFetch) => Response | Promise<Response>;

export interface FakeVoiceHandlers {
  local?: Handler;
  /** GET stt-local /health (chỉ gọi khi /transcribe quá thời gian chờ). */
  health?: Handler;
  transcriptions?: Handler;
  speech?: Handler;
}

export function stubVoiceFetch(handlers: FakeVoiceHandlers) {
  const calls: RecordedFetch[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    const handler = url.startsWith(`${STT_LOCAL_TEST_URL}/transcribe`)
      ? handlers.local
      : url.startsWith(`${STT_LOCAL_TEST_URL}/health`)
        ? handlers.health
        : url.endsWith('/audio/transcriptions')
          ? handlers.transcriptions
          : url.endsWith('/audio/speech')
            ? handlers.speech
            : undefined;
    if (!handler) throw new Error(`fetch không mong đợi: ${url}`);
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  // Gỡ bằng vi.unstubAllGlobals() + vi.unstubAllEnvs() trong afterEach.
  vi.stubEnv('STT_LOCAL_URL', STT_LOCAL_TEST_URL);
  vi.stubEnv('OPENROUTER_API_KEY', 'test-openrouter-key');
  return {
    calls,
    localCalls: () => calls.filter((c) => c.url.startsWith(`${STT_LOCAL_TEST_URL}/transcribe`)),
    healthCalls: () => calls.filter((c) => c.url.startsWith(`${STT_LOCAL_TEST_URL}/health`)),
    cloudCalls: () => calls.filter((c) => c.url.endsWith('/audio/transcriptions')),
    speechCalls: () => calls.filter((c) => c.url.endsWith('/audio/speech')),
  };
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Lỗi fetch khi AbortSignal.timeout hết giờ (giống undici), để test không phải chờ thật. */
export function timeoutError(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

/** Gemini TTS qua OpenRouter trả PCM 16-bit 24 kHz mono (đã kiểm với API thật 2026-10-21). */
export const pcmResponse = (bytes = fakePcm()) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000;channels=1', 'x-generation-id': 'gen-test' } });

export function fakePcm(size = 48): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => i % 251);
}

export const mp3Response = (bytes = fakeMp3()) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-test' } });

/** Đầu file WebM (EBML) đủ để nhận diện định dạng; nội dung còn lại là byte rỗng. */
export function fakeWebm(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return bytes;
}

export function fakeMp3(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x49, 0x44, 0x33, 0x04]);
  return bytes;
}
