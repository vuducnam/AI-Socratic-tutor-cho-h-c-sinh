import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@/server/dal/actor-authorization';
import { mintActor } from '@/server/dal/mint-actor';
import { fakePcm, jsonResponse, pcmResponse, stubVoiceFetch } from '../../../tests/helpers/fake-voice-services';
import { pcmToWav } from './pcm-to-wav';
import { seedStudentEverywhere, type SeededStudent } from '../../../tests/helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../../../tests/helpers/test-database';
import { speakTutorTurn } from './tts';
import { TtsTurnNotFoundError, TtsUnavailableError } from './voice-errors';

// TTS chỉ đọc lượt của Mít trong phiên của chính con; chữ qua toSpoken(); cache hit không gọi OpenRouter.

let a: SeededStudent;
let b: SeededStudent;
let cacheDir: string;
let seq = 100;

async function addTurn(sessionId: string, role: 'tutor' | 'student', content: string): Promise<string> {
  const id = randomUUID();
  await appDb().query(`INSERT INTO turns (id, session_id, seq, role, content) VALUES ($1, $2, $3, $4, $5)`, [id, sessionId, seq++, role, content]);
  return id;
}

async function ttsRows(turnId: string) {
  const { rows } = await appDb().query<{ request: Record<string, unknown>; error: string | null; session_id: string }>(
    `SELECT request, error, session_id FROM llm_calls WHERE turn_id = $1 AND purpose = 'tts' ORDER BY created_at`,
    [turnId],
  );
  return rows;
}

beforeAll(async () => {
  a = await seedStudentEverywhere(appDb());
  b = await seedStudentEverywhere(appDb());
});
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'cu-tts-cache-'));
  vi.stubEnv('TTS_CACHE_DIR', cacheDir);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(cacheDir, { recursive: true, force: true });
});
afterAll(closeTestDatabases);

describe('speakTutorTurn', () => {
  it('đọc lời Mít qua toSpoken (0,45 → lời đọc), ghi llm_calls, lần sau lấy từ cache không gọi OpenRouter', async () => {
    const turnId = await addTurn(a.sessionId, 'tutor', 'Bạn so sánh 0,45 với 0,5 nhé?');
    const fake = stubVoiceFetch({ speech: () => pcmResponse() });
    const actor = mintActor('student', a.studentId);

    const first = await speakTutorTurn(actor, { studentId: a.studentId, turnId });
    expect(first.cached).toBe(false);
    expect(new Uint8Array(first.audio)).toEqual(new Uint8Array(pcmToWav(Buffer.from(fakePcm()), { sampleRate: 24000, channels: 1 })));
    expect(first.voice).toBe('Sulafat');
    const sent = JSON.parse(String(fake.speechCalls()[0]!.init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      model: 'google/gemini-3.8-flash-tts',
      voice: 'Sulafat',
      instructions: expect.stringContaining('miền Nam'),
      response_format: 'pcm',
      input: 'Bạn so sánh không phẩy bốn mươi lăm với không phẩy năm nhé?',
      provider: { data_collection: 'deny' },
    });

    const rows = await ttsRows(turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toBeNull();
    expect(rows[0]!.session_id).toBe(a.sessionId);
    expect(rows[0]!.request).toMatchObject({ text_spoken: 'Bạn so sánh không phẩy bốn mươi lăm với không phẩy năm nhé?', voice: 'Sulafat' });
    expect(await readdir(join(cacheDir, a.studentId))).toHaveLength(1);

    const second = await speakTutorTurn(actor, { studentId: a.studentId, turnId });
    expect(second.cached).toBe(true);
    expect(new Uint8Array(second.audio)).toEqual(new Uint8Array(pcmToWav(Buffer.from(fakePcm()), { sampleRate: 24000, channels: 1 })));
    expect(fake.speechCalls()).toHaveLength(1);
    expect(await ttsRows(turnId)).toHaveLength(1);
  });

  it('giọng lấy từ students.companion.tts_voice nếu có', async () => {
    await appDb().query(`UPDATE students SET companion = companion || '{"tts_voice":"Puck"}' WHERE id = $1`, [b.studentId]);
    const turnId = await addTurn(b.sessionId, 'tutor', 'Bạn thử lại nhé?');
    const fake = stubVoiceFetch({ speech: () => pcmResponse() });
    const result = await speakTutorTurn(mintActor('student', b.studentId), { studentId: b.studentId, turnId });
    expect(result.voice).toBe('Puck');
    expect(JSON.parse(String(fake.speechCalls()[0]!.init.body))).toMatchObject({ voice: 'Puck' });
  });

  it('lượt của học sinh khác → AuthorizationError, không gọi OpenRouter', async () => {
    const turnId = await addTurn(b.sessionId, 'tutor', 'Lượt của bạn khác?');
    const fake = stubVoiceFetch({ speech: () => pcmResponse() });
    await expect(speakTutorTurn(mintActor('student', a.studentId), { studentId: a.studentId, turnId })).rejects.toBeInstanceOf(AuthorizationError);
    expect(fake.speechCalls()).toHaveLength(0);
  });

  it('lượt của con (không phải lời Mít) → TtsTurnNotFoundError', async () => {
    const turnId = await addTurn(a.sessionId, 'student', 'Con nghĩ là 0,45');
    stubVoiceFetch({ speech: () => pcmResponse() });
    await expect(speakTutorTurn(mintActor('student', a.studentId), { studentId: a.studentId, turnId })).rejects.toBeInstanceOf(TtsTurnNotFoundError);
  });

  it('OpenRouter lỗi → TtsUnavailableError, có dòng llm_calls ghi lỗi, không ghi cache', async () => {
    const turnId = await addTurn(a.sessionId, 'tutor', 'Mít hỏi tiếp nhé?');
    stubVoiceFetch({ speech: () => jsonResponse(402, { error: { message: 'Insufficient credits' } }) });
    await expect(speakTutorTurn(mintActor('student', a.studentId), { studentId: a.studentId, turnId })).rejects.toBeInstanceOf(TtsUnavailableError);
    const rows = await ttsRows(turnId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toContain('Insufficient credits');
    await expect(readdir(join(cacheDir, a.studentId))).rejects.toThrow();
  });

  it('OpenRouter trả không phải audio → TtsUnavailableError', async () => {
    const turnId = await addTurn(a.sessionId, 'tutor', 'Bạn nghe nhé?');
    stubVoiceFetch({ speech: () => jsonResponse(200, { ok: true }) });
    await expect(speakTutorTurn(mintActor('student', a.studentId), { studentId: a.studentId, turnId })).rejects.toBeInstanceOf(TtsUnavailableError);
  });
});
