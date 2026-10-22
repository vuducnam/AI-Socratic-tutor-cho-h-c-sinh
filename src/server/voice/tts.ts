import 'server-only';
import { toSpoken } from '@/lib/vi-math-normalizer';
import type { Actor } from '@/server/dal/actor';
import { defaultLlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { getStudentContext } from '@/server/dal/sessions-dal';
import { findActiveStudent } from '@/server/dal/students-dal';
import { getTurn } from '@/server/dal/turns-dal';
import { ttsConfig } from '@/server/llm/model-config';
import { OPENROUTER_DATA_POLICY, OpenRouterAudioError, postOpenRouterAudio } from './openrouter-audio-client';
import { parsePcmContentType, pcmToWav } from './pcm-to-wav';
import { readTtsCache, ttsCacheKey, writeTtsCache } from './tts-cache';
import { TtsTurnNotFoundError, TtsUnavailableError } from './voice-errors';

// TTS (SPEC §10): đọc một lượt của Mít trong phiên của chính học sinh. Chữ → toSpoken() (0,45 → "không
// phẩy bốn mươi lăm") → OpenRouter /audio/speech. Đầu vào là lời của Mít, không phải dữ liệu của con.
// Cache trên đĩa theo hash(model + voice + spoken); miss mới gọi OpenRouter và ghi llm_calls.

const TTS_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SPEAKABLE_ROLES = new Set(['tutor', 'system']);

export interface SpokenTurnAudio {
  audio: Buffer;
  cached: boolean;
  model: string;
  voice: string;
}

function companionVoice(companion: unknown): string | null {
  if (!companion || typeof companion !== 'object' || Array.isArray(companion)) return null;
  const voice = (companion as Record<string, unknown>).tts_voice;
  return typeof voice === 'string' && voice.trim() ? voice.trim() : null;
}

async function synthesize(spoken: string, voice: string, record: { studentId: string; sessionId: string; turnId: string }) {
  const config = ttsConfig();
  const instructions = config.style_instructions;
  const request = { endpoint: '/audio/speech', model: config.model, voice, instructions: instructions ?? null, response_format: config.response_format, text_spoken: spoken };
  const base = {
    ...record,
    purpose: 'tts',
    mode: 'live' as const,
    provider: 'openrouter',
    model: config.model,
    promptVersion: null,
    request,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  const started = Date.now();
  try {
    const res = await postOpenRouterAudio(
      '/audio/speech',
      { model: config.model, input: spoken, voice, ...(instructions ? { instructions } : {}), response_format: config.response_format, provider: OPENROUTER_DATA_POLICY },
      TTS_TIMEOUT_MS,
    );
    const contentType = res.headers.get('content-type') ?? '';
    const pcm = Buffer.from(await res.arrayBuffer());
    const format = parsePcmContentType(contentType);
    if (!format || pcm.length === 0 || pcm.length > MAX_AUDIO_BYTES) {
      throw new OpenRouterAudioError(`OpenRouter trả audio không hợp lệ (${contentType || 'không có content-type'}, ${pcm.length} byte)`, res.status);
    }
    const audio = pcmToWav(pcm, format);
    // /audio/speech trả bytes audio, không có usage trong body: chưa có số token thì để trống chi phí
    // (quy tắc cứng 4: không ước lượng). generation_id để đối chiếu với hoá đơn OpenRouter.
    await defaultLlmCallRecorder.append({
      ...base,
      response: { content_type: contentType, audio_bytes: audio.length, generation_id: res.headers.get('x-generation-id') },
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      error: null,
    });
    return audio;
  } catch (err) {
    if (!(err instanceof OpenRouterAudioError)) throw err;
    await defaultLlmCallRecorder.append({
      ...base,
      response: (err.raw as object | null) ?? null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      error: `${err.status ?? 'network'}: ${err.message}`.slice(0, 2000),
    });
    throw new TtsUnavailableError(err.message);
  }
}

/** Hồ sơ còn dùng được sau khi ghi cache (chống race với purge, xem writeTtsCache). */
async function studentStillActive(studentId: string): Promise<boolean> {
  return (await findActiveStudent(studentId)) !== null;
}

/**
 * Lời đọc (WAV) của một lượt của Mít. Lượt không thuộc học sinh → AuthorizationError (từ DAL); lượt của
 * con → TtsTurnNotFoundError; route trả 404 cho cả hai.
 */
export async function speakTutorTurn(actor: Actor, input: { studentId: string; turnId: string }): Promise<SpokenTurnAudio> {
  const turn = await getTurn(actor, { studentId: input.studentId, turnId: input.turnId });
  if (!SPEAKABLE_ROLES.has(turn.role)) throw new TtsTurnNotFoundError();
  const spoken = toSpoken(turn.content).trim();
  if (!spoken) throw new TtsTurnNotFoundError();

  const config = ttsConfig();
  const student = await getStudentContext(actor, { studentId: input.studentId });
  const voice = companionVoice(student.companion) ?? config.default_voice;
  // Đổi chỉ dẫn phong cách thì phải đọc lại, nên chỉ dẫn nằm trong khoá cache cùng giọng.
  const key = ttsCacheKey(config.model, config.style_instructions ? `${voice}|${config.style_instructions}` : voice, spoken);

  const hit = await readTtsCache(input.studentId, key);
  if (hit) return { audio: hit, cached: true, model: config.model, voice };

  const audio = await synthesize(spoken, voice, { studentId: input.studentId, sessionId: turn.session_id, turnId: turn.id });
  // Cache lỗi không làm hỏng lượt đọc: lần sau gọi lại OpenRouter.
  await writeTtsCache(input.studentId, key, audio, studentStillActive).catch((err: unknown) => console.error('[tts] ghi cache lỗi', err));
  return { audio, cached: false, model: config.model, voice };
}
