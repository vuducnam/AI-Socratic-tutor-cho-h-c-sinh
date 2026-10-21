import { describe, expect, it } from 'vitest';
import {
  formatClock,
  interpretSttResponse,
  isVoiceCaptureSupported,
  LANGUAGE_STORAGE_KEY,
  MAX_TRANSCRIPT_CHARS,
  mergeTranscript,
  MESSAGES,
  micErrorMessage,
  pickRecorderFormat,
  readStoredLanguage,
  RECORDING_LIMIT_MS,
  rmsLevel,
  submitMetaFor,
  TRANSCRIPT_LIMITS,
  voiceStatusText,
  writeStoredLanguage,
} from './voice-input-logic';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('pickRecorderFormat', () => {
  it('ưu tiên webm/opus khi trình duyệt hỗ trợ', () => {
    expect(pickRecorderFormat(() => true)).toEqual({ mimeType: 'audio/webm;codecs=opus', extension: 'webm' });
  });

  it('Safari/iPadOS: lùi về audio/mp4', () => {
    expect(pickRecorderFormat((t) => t === 'audio/mp4')).toEqual({ mimeType: 'audio/mp4', extension: 'm4a' });
  });

  it('không ghi được định dạng nào → null; hàm hỏi định dạng ném lỗi cũng không làm vỡ', () => {
    expect(pickRecorderFormat(() => false)).toBeNull();
    expect(
      pickRecorderFormat(() => {
        throw new Error('boom');
      }),
    ).toBeNull();
  });
});

describe('isVoiceCaptureSupported', () => {
  const ok = { isSecureContext: true, hasGetUserMedia: true, isTypeSupported: () => true };

  it('đủ điều kiện → hiện micro', () => {
    expect(isVoiceCaptureSupported(ok)).toBe(true);
  });

  it('không HTTPS, thiếu getUserMedia, thiếu MediaRecorder hoặc không có định dạng → ẩn micro', () => {
    expect(isVoiceCaptureSupported({ ...ok, isSecureContext: false })).toBe(false);
    expect(isVoiceCaptureSupported({ ...ok, hasGetUserMedia: false })).toBe(false);
    expect(isVoiceCaptureSupported({ ...ok, isTypeSupported: null })).toBe(false);
    expect(isVoiceCaptureSupported({ ...ok, isTypeSupported: () => false })).toBe(false);
  });
});

describe('micErrorMessage', () => {
  it('bị từ chối quyền → nhắc bật micro hoặc gõ chữ', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toBe(MESSAGES.permissionDenied);
    expect(micErrorMessage({ name: 'SecurityError' })).toBe(MESSAGES.permissionDenied);
    expect(MESSAGES.permissionDenied).toBe('Bạn bật micro cho trang này nhé, hoặc gõ chữ cũng được.');
  });

  it('không có micro, micro bận, lỗi lạ → câu thân thiện, không lộ lỗi kỹ thuật', () => {
    expect(micErrorMessage({ name: 'NotFoundError' })).toBe(MESSAGES.noMicrophone);
    expect(micErrorMessage({ name: 'NotReadableError' })).toBe(MESSAGES.micBusy);
    expect(micErrorMessage(new TypeError('x'))).toBe(MESSAGES.micFailed);
    expect(micErrorMessage(undefined)).toBe(MESSAGES.micFailed);
  });
});

describe('interpretSttResponse', () => {
  it('200 → chữ đã gom khoảng trắng', () => {
    expect(interpretSttResponse(200, { text: '  không phẩy\n bốn mươi lăm ', model: 'm', source: 'local', latencyMs: 10 })).toEqual({
      ok: true,
      text: 'không phẩy bốn mươi lăm',
    });
  });

  it('200 nhưng chữ rỗng → nhắc nói lại; thân sai dạng → lỗi thân thiện', () => {
    expect(interpretSttResponse(200, { text: '   ' })).toEqual({ ok: false, reason: 'empty', message: MESSAGES.empty });
    expect(interpretSttResponse(200, null)).toMatchObject({ ok: false, reason: 'error' });
  });

  it('chữ quá dài bị cắt theo trần chung (ô đề bài 2000 ký tự)', () => {
    expect(MAX_TRANSCRIPT_CHARS).toBe(2000);
    const r = interpretSttResponse(200, { text: 'a'.repeat(MAX_TRANSCRIPT_CHARS + 50) });
    expect(r.ok && r.text.length).toBe(MAX_TRANSCRIPT_CHARS);
  });

  it('503 → hiện message của server (hoặc câu mặc định)', () => {
    expect(interpretSttResponse(503, { error: 'stt_unavailable', message: 'Mít chưa nghe rõ, bạn gõ chữ nhé.' })).toEqual({
      ok: false,
      reason: 'unavailable',
      message: 'Mít chưa nghe rõ, bạn gõ chữ nhé.',
    });
    expect(interpretSttResponse(503, null)).toMatchObject({ reason: 'unavailable', message: MESSAGES.unavailable });
  });

  it('413, 401 và lỗi khác', () => {
    expect(interpretSttResponse(413, {})).toMatchObject({ reason: 'too_large', message: MESSAGES.tooLarge });
    // stt-local báo quá số giây → hiện câu của server.
    expect(
      interpretSttResponse(413, { error: 'too_long', message: 'Bạn nói dài quá, bạn nói ngắn hơn hoặc chia làm hai lần nhé.' }),
    ).toEqual({ ok: false, reason: 'too_large', message: 'Bạn nói dài quá, bạn nói ngắn hơn hoặc chia làm hai lần nhé.' });
    expect(interpretSttResponse(401, {})).toMatchObject({ reason: 'unauthenticated' });
    expect(interpretSttResponse(500, {})).toMatchObject({ reason: 'error', message: MESSAGES.network });
  });
});

describe('giới hạn thời lượng ghi âm', () => {
  it('tự dừng trước giới hạn của stt-local (60 giây + 1 giây dung sai), chừa ít nhất 2 giây', () => {
    expect(RECORDING_LIMIT_MS).toBe(58_000);
    expect(60_000 - RECORDING_LIMIT_MS).toBeGreaterThanOrEqual(2_000);
  });
});

describe('mergeTranscript', () => {
  const chat = TRANSCRIPT_LIMITS.chat;
  it('ô trống → chữ vừa nghe; đã có chữ → nối thêm bằng một khoảng trắng', () => {
    expect(mergeTranscript('', ' 0,45 kg ', chat)).toBe('0,45 kg');
    expect(mergeTranscript('   ', 'ba phần tư', chat)).toBe('ba phần tư');
    expect(mergeTranscript('Mình nghĩ là ', 'nhân hai', chat)).toBe('Mình nghĩ là nhân hai');
    expect(mergeTranscript('giữ nguyên', '  ', chat)).toBe('giữ nguyên');
  });

  it('không vượt giới hạn của ô: chat 1000, đề bài 2000', () => {
    expect(TRANSCRIPT_LIMITS).toEqual({ chat: 1000, problem: 2000 });
    expect(mergeTranscript('a'.repeat(990), 'b'.repeat(50), chat)).toHaveLength(1000);
    expect(mergeTranscript('a'.repeat(990), 'b'.repeat(50), TRANSCRIPT_LIMITS.problem)).toHaveLength(1041);
    expect(mergeTranscript('a'.repeat(1990), 'b'.repeat(50), TRANSCRIPT_LIMITS.problem)).toHaveLength(2000);
  });
});

describe('submitMetaFor', () => {
  it('có bản chép giọng nói → voice kèm rawStt nguyên văn (kể cả khi con đã sửa chữ)', () => {
    expect(submitMetaFor('không phẩy bốn lăm', TRANSCRIPT_LIMITS.chat)).toEqual({ inputModality: 'voice', rawStt: 'không phẩy bốn lăm' });
  });

  it('không có bản chép → text, không gửi rawStt', () => {
    expect(submitMetaFor(null, TRANSCRIPT_LIMITS.chat)).toEqual({ inputModality: 'text' });
    expect(submitMetaFor('  ', TRANSCRIPT_LIMITS.chat)).toEqual({ inputModality: 'text' });
  });

  it('rawStt cắt theo giới hạn của ô', () => {
    expect(submitMetaFor('a'.repeat(1500), TRANSCRIPT_LIMITS.chat).rawStt).toHaveLength(1000);
    expect(submitMetaFor('a'.repeat(1500), TRANSCRIPT_LIMITS.problem).rawStt).toHaveLength(1500);
  });
});

describe('formatClock, rmsLevel, voiceStatusText', () => {
  it('đếm ngược làm tròn lên theo giây', () => {
    expect(formatClock(60_000)).toBe('1:00');
    expect(formatClock(41_200)).toBe('0:42');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('im lặng = 0, to hết cỡ bị chặn ở 1', () => {
    expect(rmsLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsLevel(new Uint8Array(64).fill(255))).toBe(1);
    expect(rmsLevel([])).toBe(0);
  });

  it('đang chuyển giọng thành chữ → "Mít đang nghe…"; lỗi → câu lỗi', () => {
    expect(voiceStatusText('transcribing', null)).toBe('Mít đang nghe…');
    expect(voiceStatusText('error', MESSAGES.permissionDenied)).toBe(MESSAGES.permissionDenied);
    expect(voiceStatusText('idle', MESSAGES.review)).toBe(MESSAGES.review);
  });
});

describe('ngôn ngữ nói nhớ theo máy', () => {
  it('chưa chọn → mặc định của phụ huynh; đã chọn → giá trị đã lưu', () => {
    expect(readStoredLanguage(memoryStorage(), 'en')).toBe('en');
    expect(readStoredLanguage(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'vi' }), 'en')).toBe('vi');
  });

  it('giá trị lạ, không có storage hoặc storage ném lỗi → mặc định', () => {
    expect(readStoredLanguage(memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'fr' }), 'vi')).toBe('vi');
    expect(readStoredLanguage(null, 'vi')).toBe('vi');
    expect(readStoredLanguage(throwingStorage, 'en')).toBe('en');
  });

  it('ghi lại lựa chọn; storage ném lỗi thì im lặng bỏ qua', () => {
    const s = memoryStorage();
    writeStoredLanguage(s, 'en');
    expect(s.data.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(() => writeStoredLanguage(throwingStorage, 'vi')).not.toThrow();
  });
});
