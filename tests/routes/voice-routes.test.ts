import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@/server/dal/actor';
import { mintActor } from '@/server/dal/mint-actor';
import { fakePcm, fakeWebm, jsonResponse, pcmResponse, stubVoiceFetch } from '../helpers/fake-voice-services';
import { pcmToWav } from '@/server/voice/pcm-to-wav';
import { seedStudentEverywhere, type SeededStudent } from '../helpers/seed-student-everywhere';
import { appDb, closeTestDatabases } from '../helpers/test-database';

// Route /api/stt, /api/tts, /api/chat (phần voice) và Server Action cài đặt giọng nói: chỉ học sinh gọi
// được route voice; validate đầu vào; lỗi STT → 503 với câu thân thiện; TTS chỉ lượt của Mít của chính con.

const session = vi.hoisted(() => ({ actor: null as unknown }));
const runTurn = vi.hoisted(() => ({ calls: [] as unknown[] }));
const typedProblem = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('@/server/auth/session', () => {
  class UnauthenticatedError extends Error {
    readonly code = 'UNAUTHENTICATED';
  }
  const current = (type: string) => {
    const actor = session.actor as Actor | null;
    if (!actor || actor.type !== type) throw new UnauthenticatedError('Chưa đăng nhập');
    return actor;
  };
  return {
    UnauthenticatedError,
    requireStudentActor: async () => current('student'),
    requireParentActor: async () => current('parent'),
  };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest' }) }));
vi.mock('@/server/domain/dialogue/run-turn', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runStudentTurn: async (_actor: unknown, input: unknown) => {
    runTurn.calls.push(input);
    return { tutorTurnId: randomUUID(), studentTurnId: randomUUID(), message: 'Bạn thử nhé?' };
  },
}));
vi.mock('@/server/domain/session/learn-flow', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertTimeLeft: async () => null,
  submitTypedProblem: async (_actor: unknown, input: unknown) => {
    typedProblem.calls.push(input);
    return { ok: true };
  },
}));

const { POST: sttRoute } = await import('@/app/api/stt/route');
const { POST: ttsRoute } = await import('@/app/api/tts/route');
const { POST: chatRoute } = await import('@/app/api/chat/route');
const { POST: problemRoute } = await import('@/app/api/learn/problem/route');
const { updateVoicePrefsAction } = await import('@/app/(parent)/parent/settings/actions');

let a: SeededStudent;
let b: SeededStudent;
let cacheDir: string;

beforeAll(async () => {
  a = await seedStudentEverywhere(appDb());
  b = await seedStudentEverywhere(appDb());
});
beforeEach(async () => {
  session.actor = mintActor('student', a.studentId);
  // Biên nhận STT ký bằng SESSION_SECRET.
  vi.stubEnv('SESSION_SECRET', 'test-session-secret-0123456789');
  cacheDir = await mkdtemp(join(tmpdir(), 'cu-tts-route-'));
  vi.stubEnv('TTS_CACHE_DIR', cacheDir);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(cacheDir, { recursive: true, force: true });
});
afterAll(closeTestDatabases);

/** Multipart đã mã hoá thành bytes + Content-Type (có boundary), như trình duyệt gửi. */
async function encodeSttForm(fields: { audio?: Blob | null; language?: string; sessionId?: string }) {
  const form = new FormData();
  if (fields.audio !== null) form.append('audio', fields.audio ?? new Blob([new Uint8Array(fakeWebm())], { type: 'audio/webm;codecs=opus' }), 'voice.webm');
  form.append('language', fields.language ?? 'vi');
  form.append('sessionId', fields.sessionId ?? a.sessionId);
  const encoded = new Response(form);
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') ?? '' };
}

/** Request như trình duyệt gửi FormData: có Content-Length đúng (hoặc giá trị ghi đè cho test). */
async function sttRequest(fields: { audio?: Blob | null; language?: string; sessionId?: string }, contentLength?: string | null) {
  const { bytes, contentType } = await encodeSttForm(fields);
  const headers = new Headers({ 'content-type': contentType });
  const length = contentLength === undefined ? String(bytes.byteLength) : contentLength;
  if (length !== null) headers.set('content-length', length);
  return new Request('http://app.test/api/stt', { method: 'POST', body: bytes, headers });
}

/** Body dạng stream (chunked, không có Content-Length trừ khi truyền vào). */
function streamingSttRequest(source: UnderlyingDefaultSource<Uint8Array>, headers: Record<string, string>) {
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body: new ReadableStream<Uint8Array>(source), duplex: 'half' };
  return new Request('http://app.test/api/stt', init);
}

const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const localOk = () => jsonResponse(200, { text: 'không phẩy năm', model: 'vinai/PhoWhisper-large', language: 'vi', latency_ms: 90 });

describe('POST /api/stt', () => {
  it('học sinh gửi ghi âm hợp lệ → chữ từ stt-local', async () => {
    stubVoiceFetch({ local: localOk });
    const res = await sttRoute(await sttRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ text: 'không phẩy năm', model: 'vinai/PhoWhisper-large', source: 'local' });
    expect(body.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('phụ huynh không gọi được (chỉ phiên học sinh)', async () => {
    session.actor = mintActor('parent', a.parentId);
    const fake = stubVoiceFetch({ local: localOk });
    const res = await sttRoute(await sttRequest({}));
    expect(res.status).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });

  it('thiếu audio, ngôn ngữ lạ, sessionId sai → 400; MIME lạ → 415', async () => {
    stubVoiceFetch({ local: localOk });
    expect((await sttRoute(await sttRequest({ audio: null }))).status).toBe(400);
    expect((await sttRoute(await sttRequest({ language: 'fr' }))).status).toBe(400);
    expect((await sttRoute(await sttRequest({ sessionId: 'không-phải-uuid' }))).status).toBe(400);
    expect((await sttRoute(await sttRequest({ audio: new Blob([new Uint8Array(fakeWebm())], { type: 'text/plain' }) }))).status).toBe(415);
  });

  it('quá stt.max_bytes → 413, không gọi stt-local', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(fakeWebm());
    const res = await sttRoute(await sttRequest({ audio: new Blob([big], { type: 'audio/webm' }) }));
    expect(res.status).toBe(413);
    expect(fake.calls).toHaveLength(0);
  });

  it('thiếu Content-Length (Cloudflare Tunnel có thể chuyển sang chunked) → vẫn nhận, giới hạn bằng bộ đếm byte', async () => {
    stubVoiceFetch({ local: localOk });
    const { bytes, contentType } = await encodeSttForm({});
    const chunked = streamingSttRequest(
      {
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { 'content-type': contentType },
    );
    expect(chunked.headers.get('content-length')).toBeNull();
    expect((await sttRoute(chunked)).status).toBe(200);
    expect((await sttRoute(await sttRequest({}, 'abc'))).status).toBe(200);
  });

  it('Content-Length khai quá trần → 413 ngay; khai nhỏ nhưng body thật vượt trần → 413, dừng đọc', async () => {
    const fake = stubVoiceFetch({ local: localOk });
    const limit = 10 * 1024 * 1024 + 64 * 1024;
    expect((await sttRoute(await sttRequest({}, String(limit + 1)))).status).toBe(413);

    // Header nói dối là nhỏ nhưng stream không dừng: route đếm byte thật và huỷ stream khi vượt trần.
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const lying = streamingSttRequest(
      {
        pull(controller) {
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '1000' },
    );
    expect((await sttRoute(lying)).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(limit + 2 * chunk.byteLength);
    expect(fake.calls).toHaveLength(0);
  });

  it('stt-local báo quá dài (413) → 413 too_long với câu nhắc nói ngắn hơn, không gửi cloud', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(413, { detail: 'audio_too_long' }), transcriptions: () => jsonResponse(200, { text: 'x' }) });
    const res = await sttRoute(await sttRequest({}));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too_long', message: 'Bạn nói dài quá, bạn nói ngắn hơn hoặc chia làm hai lần nhé.' });
    expect(fake.cloudCalls()).toHaveLength(0);
  });

  it('phiên của học sinh khác → 404', async () => {
    stubVoiceFetch({ local: localOk });
    expect((await sttRoute(await sttRequest({ sessionId: b.sessionId }))).status).toBe(404);
  });

  it('stt-local lỗi, phụ huynh chưa bật cloud → 503 với câu thân thiện', async () => {
    const fake = stubVoiceFetch({ local: () => jsonResponse(503, {}), transcriptions: () => jsonResponse(200, { text: 'x' }) });
    const res = await sttRoute(await sttRequest({}));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'stt_unavailable', message: 'Mít chưa nghe rõ, bạn gõ chữ nhé.' });
    expect(fake.cloudCalls()).toHaveLength(0);
  });
});

describe('POST /api/tts', () => {
  async function tutorTurn(sessionId: string, content: string): Promise<string> {
    const id = randomUUID();
    const { rows } = await appDb().query<{ n: number }>('SELECT coalesce(max(seq), 0) + 1 AS n FROM turns WHERE session_id = $1', [sessionId]);
    await appDb().query(`INSERT INTO turns (id, session_id, seq, role, content) VALUES ($1, $2, $3, 'tutor', $4)`, [id, sessionId, rows[0]!.n, content]);
    return id;
  }

  it('lượt của Mít trong phiên của con → audio/wav, không cache ở trình duyệt', async () => {
    stubVoiceFetch({ speech: () => pcmResponse() });
    const turnId = await tutorTurn(a.sessionId, 'Bạn đọc lại đề nhé?');
    const res = await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(pcmToWav(Buffer.from(fakePcm()), { sampleRate: 24000, channels: 1 })));
  });

  it('lượt của học sinh khác hoặc không tồn tại → 404; turnId sai → 400', async () => {
    const fake = stubVoiceFetch({ speech: () => pcmResponse() });
    const otherTurn = await tutorTurn(b.sessionId, 'Lượt của bạn khác?');
    expect((await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId: otherTurn }))).status).toBe(404);
    expect((await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId: randomUUID() }))).status).toBe(404);
    expect((await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId: 'x' }))).status).toBe(400);
    expect(fake.speechCalls()).toHaveLength(0);
  });

  it('OpenRouter lỗi → 503', async () => {
    stubVoiceFetch({ speech: () => jsonResponse(500, {}) });
    const turnId = await tutorTurn(a.sessionId, 'Bạn nghe nhé?');
    expect((await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId }))).status).toBe(503);
  });

  it('phụ huynh không gọi được', async () => {
    session.actor = mintActor('parent', a.parentId);
    const turnId = await tutorTurn(a.sessionId, 'Bạn nghe nhé?');
    expect((await ttsRoute(jsonRequest('http://app.test/api/tts', { turnId }))).status).toBe(401);
  });
});

/** Đoạn STT kèm biên nhận lấy thật từ /api/stt (stt-local giả trả `text`). */
async function heardPiece(text: string): Promise<{ text: string; receipt: string }> {
  stubVoiceFetch({ local: () => jsonResponse(200, { text, model: 'vinai/PhoWhisper-large', language: 'vi', latency_ms: 90 }) });
  const body = (await (await sttRoute(await sttRequest({}))).json()) as { text: string; receipt: string };
  vi.unstubAllGlobals();
  return { text: body.text, receipt: body.receipt };
}

describe('POST /api/chat (voice)', () => {
  const base = () => ({ sessionId: a.sessionId, text: 'Con nghĩ là 0,5', idempotencyKey: randomUUID() });

  it('raw_stt ghép từ các đoạn có biên nhận của /api/stt, theo thứ tự nói', async () => {
    const pieces = [await heardPiece('con nghĩ là'), await heardPiece('  không phẩy\n năm ')];
    expect(pieces[1]!.text).toBe('không phẩy năm');
    runTurn.calls.length = 0;
    await (await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'voice', sttPieces: pieces }))).text();
    expect(runTurn.calls.at(-1)).toMatchObject({ inputModality: 'voice', rawStt: 'con nghĩ là không phẩy năm', text: 'Con nghĩ là 0,5' });
  });

  it('chữ bị sửa sau khi ký, biên nhận giả hoặc của phiên khác → không lưu raw_stt (tin vẫn gửi)', async () => {
    const piece = await heardPiece('không phẩy năm');
    runTurn.calls.length = 0;
    await (await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'voice', sttPieces: [{ ...piece, text: 'không phẩy sáu' }] }))).text();
    expect(runTurn.calls.at(-1)).toMatchObject({ inputModality: 'voice', rawStt: null });
    await (await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'voice', sttPieces: [{ text: 'tự khai', receipt: 'abc' }] }))).text();
    expect(runTurn.calls.at(-1)).toMatchObject({ rawStt: null });
    await (await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), sessionId: b.sessionId, inputModality: 'voice', sttPieces: [piece] }))).text();
    expect(runTurn.calls.at(-1)).toMatchObject({ rawStt: null });
  });

  it('tin gõ: mặc định text, bỏ qua sttPieces', async () => {
    const piece = await heardPiece('bỏ qua');
    runTurn.calls.length = 0;
    await (await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), sttPieces: [piece] }))).text();
    expect(runTurn.calls.at(-1)).toMatchObject({ inputModality: 'text', rawStt: null });
  });

  it('đoạn quá 2000 ký tự, quá 20 đoạn hoặc inputModality lạ → 400', async () => {
    const big = [{ text: 'a'.repeat(2001), receipt: 'x' }];
    const many = Array.from({ length: 21 }, () => ({ text: 'a', receipt: 'x' }));
    expect((await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'voice', sttPieces: big }))).status).toBe(400);
    expect((await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'voice', sttPieces: many }))).status).toBe(400);
    expect((await chatRoute(jsonRequest('http://app.test/api/chat', { ...base(), inputModality: 'video' }))).status).toBe(400);
  });
});

describe('POST /api/learn/problem (voice)', () => {
  const base = () => ({ sessionId: a.sessionId, text: 'Tính 4,5 + 1', inputModality: 'voice' });

  it('raw_stt từ đoạn có biên nhận; không có đoạn hoặc tin gõ → null', async () => {
    const piece = await heardPiece('tính bốn phẩy năm cộng một');
    typedProblem.calls.length = 0;
    await (await problemRoute(jsonRequest('http://app.test/api/learn/problem', { ...base(), sttPieces: [piece] }))).text();
    expect(typedProblem.calls.at(-1)).toMatchObject({ text: 'Tính 4,5 + 1', rawStt: 'tính bốn phẩy năm cộng một' });
    await (await problemRoute(jsonRequest('http://app.test/api/learn/problem', { ...base(), sttPieces: [] }))).text();
    expect(typedProblem.calls.at(-1)).toMatchObject({ rawStt: null });
    await (await problemRoute(jsonRequest('http://app.test/api/learn/problem', { ...base(), inputModality: 'text', sttPieces: [piece] }))).text();
    expect(typedProblem.calls.at(-1)).toMatchObject({ rawStt: null });
  });
});

describe('updateVoicePrefsAction', () => {
  it('phụ huynh liên kết bật/tắt từng mục; checkbox không tích là tắt', async () => {
    session.actor = mintActor('parent', a.parentId);
    const form = new FormData();
    form.set('studentId', a.studentId);
    form.set('ttsAutoplay', 'on');
    form.set('sttLanguage', 'en');
    const err = await updateVoicePrefsAction(form).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((err as { digest?: string } | null)?.digest)).toContain('ok=');
    const { rows } = await appDb().query<{ learning_prefs: Record<string, unknown> }>('SELECT learning_prefs FROM students WHERE id = $1', [a.studentId]);
    expect(rows[0]!.learning_prefs).toMatchObject({ tts_autoplay: true, stt_cloud_fallback: false, stt_language: 'en' });
  });

  it('phụ huynh không liên kết → thông báo lỗi, dữ liệu không đổi', async () => {
    session.actor = mintActor('parent', b.parentId);
    const form = new FormData();
    form.set('studentId', a.studentId);
    form.set('sttCloudFallback', 'on');
    form.set('sttLanguage', 'vi');
    const err = await updateVoicePrefsAction(form).then(
      () => null,
      (e: unknown) => e,
    );
    expect(String((err as { digest?: string } | null)?.digest)).toContain('err=');
    const { rows } = await appDb().query<{ learning_prefs: Record<string, unknown> }>('SELECT learning_prefs FROM students WHERE id = $1', [a.studentId]);
    expect(rows[0]!.learning_prefs.stt_cloud_fallback).not.toBe(true);
  });
});
