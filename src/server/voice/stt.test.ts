import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintActor } from '@/server/dal/mint-actor';
import { fakeMp3, fakeWebm, jsonResponse, stubVoiceFetch, timeoutError } from '../../../tests/helpers/fake-voice-services';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { transcribe, transcribeStudentAudio } from './stt';
import { SttAudioTooLongError, SttUnavailableError, UnsupportedAudioError, VoiceSessionClosedError } from './voice-errors';

// Quy tắc cứng 10: giọng con xử lý ở PC; cloud chỉ khi local lỗi VÀ phụ huynh cho phép. Lượt cloud ghi
// llm_calls nhưng không có bytes audio.

let s: SeededStudent;
beforeAll(async () => {
  s = await seedStudentEverywhere(appDb());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(closeTestDatabases);

const localOk = () => jsonResponse(200, { text: ' không phẩy bốn mươi lăm ', model: 'vinai/PhoWhisper-large', language: 'vi', latency_ms: 120 });
const cloudOk = () => jsonResponse(200, { text: 'xin chào', usage: { seconds: 4, input_tokens: 40, output_tokens: 5 } });

function input(overrides: Partial<Parameters<typeof transcribe>[0]> = {}): Parameters<typeof transcribe>[0] {
  return {
    audio: fakeWebm(),
    mimeType: 'audio/webm;codecs=opus',
    language: 'vi',
    studentId: s.studentId,
    sessionId: s.sessionId,
    cloudFallbackAllowed: false,
    ...overrides,
  };
}

async function sttRows() {
  const { rows } = await appDb().query<{ request: Record<string, unknown>; response: unknown; cost: number | null; error: string | null; provider: string }>(
    `SELECT request, response, cost_usd::float AS cost, error, provider FROM llm_calls WHERE student_id = $1 AND purpose = 'stt' ORDER BY created_at`,
    [s.studentId],
  );
  return rows;
}

describe('transcribe', () => {
  it('local thành công: trả chữ, không gọi cloud, không ghi llm_calls; gửi đúng ngôn ngữ và model theo config', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    const before = (await sttRows()).length;
    const result = await transcribe(input({ cloudFallbackAllowed: true }));
    expect(result).toMatchObject({ text: 'không phẩy bốn mươi lăm', model: 'vinai/PhoWhisper-large', source: 'local' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fake.cloudCalls()).toHaveLength(0);
    const form = fake.localCalls()[0]!.init.body as FormData;
    expect(form.get('language')).toBe('vi');
    expect(form.get('model')).toBe('vinai/PhoWhisper-large');
    expect(form.get('audio')).toBeInstanceOf(Blob);
    expect((await sttRows()).length).toBe(before);
  });

  it('tiếng Anh dùng model local cho en', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    await transcribe(input({ language: 'en' }));
    expect((fake.localCalls()[0]!.init.body as FormData).get('model')).toBe('openai/whisper-large-v3-turbo');
  });

  it('local lỗi và phụ huynh CHƯA cho phép → SttUnavailableError, không gửi audio ra ngoài', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(503, { detail: 'down' }), transcriptions: cloudOk });
    await expect(transcribe(input({ cloudFallbackAllowed: false }))).rejects.toBeInstanceOf(SttUnavailableError);
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('local không chạy (lỗi mạng) và được phép → cloud; llm_calls có metadata, KHÔNG có bytes audio', async () => {
    const audio = fakeWebm(256);
    audio.fill(0x5a, 4);
    const base64 = Buffer.from(audio).toString('base64');
    const fake = stubVoiceFetch({
      local: () => {
        throw new TypeError('fetch failed');
      },
      transcriptions: cloudOk,
    });
    const before = (await sttRows()).length;
    const result = await transcribe(input({ audio, cloudFallbackAllowed: true }));
    expect(result).toMatchObject({ text: 'xin chào', model: 'openai/gpt-transcribe', source: 'cloud' });

    const sent = JSON.parse(String(fake.cloudCalls()[0]!.init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: 'openai/gpt-transcribe', language: 'vi', input_audio: { data: base64, format: 'webm' }, provider: { data_collection: 'deny' } });

    const rows = await sttRows();
    expect(rows.length).toBe(before + 1);
    const row = rows.at(-1)!;
    expect(row.provider).toBe('openrouter');
    expect(row.error).toBeNull();
    expect(row.request).toMatchObject({ model: 'openai/gpt-transcribe', mime_type: 'audio/webm', audio_bytes: 256, audio_seconds: 4, language: 'vi' });
    expect(JSON.stringify(row.request)).not.toContain(base64.slice(0, 40));
    // Không có giá trong usage → tính theo config: 4 giây × 0,000075 USD.
    expect(row.cost).toBeCloseTo(0.0003, 6);
  });

  it('cloud cũng lỗi → SttUnavailableError, vẫn có dòng llm_calls ghi lỗi', async () => {
    stubVoiceFetch({ local: () => jsonResponse(500, {}), transcriptions: () => jsonResponse(502, { error: { message: 'upstream' } }) });
    const before = (await sttRows()).length;
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).rejects.toBeInstanceOf(SttUnavailableError);
    const rows = await sttRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.error).toContain('upstream');
  });

  it('local từ chối audio (4xx) → không gửi cloud dù được phép', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(400, { detail: 'bad audio' }), transcriptions: cloudOk });
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).rejects.toBeInstanceOf(SttUnavailableError);
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('không có key OpenRouter → không thử cloud', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(503, {}), transcriptions: cloudOk });
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).rejects.toBeInstanceOf(SttUnavailableError);
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('local quá thời gian nhưng /health vẫn trả lời → SttUnavailableError, KHÔNG gửi cloud dù được phép', async () => {
    const fake = stubVoiceFetch({
      local: () => {
        throw timeoutError();
      },
      health: () => jsonResponse(200, { status: 'ok' }),
      transcriptions: cloudOk,
    });
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).rejects.toBeInstanceOf(SttUnavailableError);
    expect(fake.healthCalls()).toHaveLength(1);
    expect(fake.cloudCalls()).toHaveLength(0);
    // /health phải có hạn chờ ngắn của riêng nó.
    expect(fake.healthCalls()[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('local quá thời gian và /health cũng hỏng (5xx hoặc lỗi mạng) → cloud khi được phép', async () => {
    for (const health of [() => jsonResponse(503, {}), () => Promise.reject(new TypeError('fetch failed'))]) {
      const fake = stubVoiceFetch({
        local: () => {
          throw timeoutError();
        },
        health,
        transcriptions: cloudOk,
      });
      await expect(transcribe(input({ cloudFallbackAllowed: true }))).resolves.toMatchObject({ source: 'cloud', text: 'xin chào' });
      expect(fake.healthCalls()).toHaveLength(1);
      expect(fake.cloudCalls()).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('local lỗi 5xx → không hỏi /health, đi thẳng cloud khi được phép', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(500, {}), transcriptions: cloudOk });
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).resolves.toMatchObject({ source: 'cloud' });
    expect(fake.healthCalls()).toHaveLength(0);
  });

  it('local trả 413 (quá số giây) → SttAudioTooLongError, không gửi cloud', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(413, { detail: 'audio_too_long' }), transcriptions: cloudOk });
    await expect(transcribe(input({ cloudFallbackAllowed: true }))).rejects.toBeInstanceOf(SttAudioTooLongError);
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('mp3 không được nhận (stt-local không giải mã mp3)', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    await expect(transcribe(input({ audio: fakeMp3(64), mimeType: 'audio/mpeg' }))).rejects.toBeInstanceOf(UnsupportedAudioError);
    await expect(transcribe(input({ audio: fakeMp3(64), mimeType: 'audio/webm' }))).rejects.toBeInstanceOf(UnsupportedAudioError);
    expect(fake.calls).toHaveLength(0);
  });

  it('bytes không phải audio hoặc MIME lạ → UnsupportedAudioError, không gọi dịch vụ nào', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    await expect(transcribe(input({ audio: new Uint8Array(64).fill(1) }))).rejects.toBeInstanceOf(UnsupportedAudioError);
    await expect(transcribe(input({ mimeType: 'application/pdf' }))).rejects.toBeInstanceOf(UnsupportedAudioError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('transcribeStudentAudio', () => {
  it('quyền dùng cloud lấy từ cài đặt phụ huynh (mặc định tắt)', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(503, {}), transcriptions: cloudOk });
    const actor = mintActor('student', s.studentId);
    await expect(
      transcribeStudentAudio(actor, { studentId: s.studentId, sessionId: s.sessionId, audio: fakeWebm(), mimeType: 'audio/webm', language: 'vi' }),
    ).rejects.toBeInstanceOf(SttUnavailableError);
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('phiên đã đóng → VoiceSessionClosedError', async () => {
    const other = await seedStudentEverywhere(appDb());
    await appDb().query(`UPDATE sessions SET ended_at = now(), end_reason = 'student_done' WHERE id = $1`, [other.sessionId]);
    stubVoiceFetch({ local: localOk });
    const actor = mintActor('student', other.studentId);
    await expect(
      transcribeStudentAudio(actor, { studentId: other.studentId, sessionId: other.sessionId, audio: fakeWebm(), mimeType: 'audio/webm', language: 'vi' }),
    ).rejects.toBeInstanceOf(VoiceSessionClosedError);
  });
});
