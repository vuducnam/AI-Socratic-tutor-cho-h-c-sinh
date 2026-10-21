import 'server-only';
import { z } from 'zod';
import type { Actor } from '@/server/dal/actor';
import { defaultLlmCallRecorder } from '@/server/dal/llm-calls-dal';
import { getLearningSession } from '@/server/dal/sessions-dal';
import { raiseSystemAlert } from '@/server/dal/system-alerts-dal';
import { getStudentVoicePrefs, type SttLanguage } from '@/server/dal/voice-prefs-dal';
import { sttConfig } from '@/server/llm/model-config';
import { AUDIO_FORMAT_MIME, baseAudioMime, detectAudioFormat, type AudioFormat } from './audio-format';
import { OPENROUTER_DATA_POLICY, OpenRouterAudioError, openRouterAudioConfigured, postOpenRouterAudio } from './openrouter-audio-client';
import { toVietnameseNumberStyle } from './english-number-format';
import { normalizeTranscript, signSttReceipt } from './stt-receipt';
import { SttAudioTooLongError, SttUnavailableError, UnsupportedAudioError, VoiceSessionClosedError } from './voice-errors';

// STT (quy tắc cứng 10, SPEC §10): giọng con xử lý ở PC (services/stt-local). Chỉ khi local lỗi VÀ phụ
// huynh bật stt_cloud_fallback mới gửi lên OpenRouter. Bytes audio chỉ nằm trong bộ nhớ của request:
// không ghi đĩa, không ghi DB; dòng llm_calls của lượt cloud chỉ có metadata (mime, số byte, số giây).

// GPU ở nhà có thể chậm khi vừa nạp model hoặc đang bận lượt khác: chờ 45 giây. Quá giờ thì hỏi /health
// (≤ 2 giây): local còn sống nghĩa là chỉ chậm → báo con gõ chữ, KHÔNG gửi giọng con lên cloud (quy tắc
// 10: cloud chỉ khi máy ở nhà hỏng hẳn).
const LOCAL_TIMEOUT_MS = 45_000;
const LOCAL_HEALTH_TIMEOUT_MS = 2_000;
const CLOUD_TIMEOUT_MS = 30_000;

export type SttSource = 'local' | 'cloud';

export interface TranscribeInput {
  audio: Uint8Array;
  mimeType: string;
  language: SttLanguage;
  studentId: string;
  sessionId: string | null;
  cloudFallbackAllowed: boolean;
}

export interface TranscribeResult {
  text: string;
  model: string;
  source: SttSource;
  latencyMs: number;
}

const localResponseSchema = z.object({ text: z.string(), model: z.string(), language: z.string(), latency_ms: z.number() });
const cloudResponseSchema = z.object({
  text: z.string(),
  usage: z
    .object({
      seconds: z.number().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

/** Lỗi phía stt-local; `cloudEligible = false` khi chính audio bị từ chối (4xx) — gửi cloud cũng vô ích. */
class LocalSttError extends Error {
  constructor(message: string, readonly cloudEligible: boolean) {
    super(message);
  }
}

/** fetch bị AbortSignal.timeout huỷ → DOMException tên TimeoutError. */
function isTimeoutError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'TimeoutError';
}

/** stt-local còn trả lời /health (2xx) trong ≤ 2 giây; mọi lỗi mạng/timeout/5xx → coi như hỏng. */
async function localHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET', signal: AbortSignal.timeout(LOCAL_HEALTH_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

async function transcribeLocal(audio: Uint8Array, format: AudioFormat, language: SttLanguage): Promise<Omit<TranscribeResult, 'source'>> {
  const config = sttConfig();
  const baseUrl = process.env[config.local_url_env]?.replace(/\/$/, '');
  if (!baseUrl) throw new LocalSttError(`chưa đặt ${config.local_url_env}`, true);
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(audio)], { type: AUDIO_FORMAT_MIME[format] }), `audio.${format}`);
  form.append('language', language);
  form.append('model', config.local_models[language]);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/transcribe`, { method: 'POST', body: form, signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS) });
  } catch (err) {
    if (isTimeoutError(err)) {
      if (await localHealthy(baseUrl)) throw new SttUnavailableError([`local: quá ${LOCAL_TIMEOUT_MS / 1000} giây nhưng stt-local vẫn chạy`]);
      throw new LocalSttError(`stt-local quá ${LOCAL_TIMEOUT_MS / 1000} giây và không trả lời /health`, true);
    }
    throw new LocalSttError(`không gọi được stt-local: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  // 413: chính đoạn ghi âm quá dài/quá nặng — gửi cloud cũng không nên, con nói ngắn lại.
  if (res.status === 413) throw new SttAudioTooLongError();
  if (!res.ok) throw new LocalSttError(`stt-local HTTP ${res.status}`, res.status >= 500);
  const parsed = localResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new LocalSttError('stt-local trả dữ liệu sai định dạng', true);
  return { text: parsed.data.text.trim(), model: parsed.data.model, latencyMs: Date.now() - started };
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

async function transcribeCloud(input: TranscribeInput, format: AudioFormat): Promise<Omit<TranscribeResult, 'source'>> {
  const config = sttConfig();
  const model = config.cloud_fallback;
  // Bản ghi request trong llm_calls: KHÔNG có bytes/base64 audio.
  const recordedRequest = {
    endpoint: '/audio/transcriptions',
    model,
    language: input.language,
    mime_type: AUDIO_FORMAT_MIME[format],
    format,
    audio_bytes: input.audio.byteLength,
    audio_seconds: null as number | null,
    audio: '[không lưu audio]',
  };
  const base = {
    studentId: input.studentId,
    sessionId: input.sessionId,
    turnId: null,
    purpose: 'stt',
    mode: 'live' as const,
    provider: 'openrouter',
    model,
    promptVersion: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  const started = Date.now();
  try {
    const res = await postOpenRouterAudio(
      '/audio/transcriptions',
      {
        model,
        input_audio: { data: Buffer.from(input.audio).toString('base64'), format },
        language: input.language,
        provider: OPENROUTER_DATA_POLICY,
      },
      CLOUD_TIMEOUT_MS,
    );
    const raw: unknown = await res.json().catch(() => null);
    const parsed = cloudResponseSchema.safeParse(raw);
    if (!parsed.success) throw new OpenRouterAudioError('OpenRouter trả dữ liệu STT sai định dạng', res.status, raw);
    const usage = parsed.data.usage;
    const seconds = usage?.seconds ?? null;
    const pricePerSecond = config.cloud_pricing_usd_per_second[model];
    const cost = usage?.cost ?? (seconds !== null && pricePerSecond !== undefined ? seconds * pricePerSecond : null);
    const latencyMs = Date.now() - started;
    // Ghi llm_calls TRƯỚC khi trả kết quả (SPEC §2.1).
    await defaultLlmCallRecorder.append({
      ...base,
      request: { ...recordedRequest, audio_seconds: seconds },
      response: parsed.data,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      costUsd: cost === null ? null : roundUsd(cost),
      latencyMs,
      error: null,
    });
    return { text: parsed.data.text.trim(), model, latencyMs };
  } catch (err) {
    if (!(err instanceof OpenRouterAudioError)) throw err;
    await defaultLlmCallRecorder.append({
      ...base,
      request: recordedRequest,
      response: (err.raw as object | null) ?? null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      latencyMs: Date.now() - started,
      error: `${err.status ?? 'network'}: ${err.message}`.slice(0, 2000),
    });
    throw new SttUnavailableError([`cloud: ${err.message}`]);
  }
}

/** Chữ STT tiếng Anh viết số kiểu Anh: đổi sang dấu phẩy thập phân trước khi con thấy. */
function styled(result: TranscribeResult, language: string): TranscribeResult {
  return language === 'en' ? { ...result, text: toVietnameseNumberStyle(result.text) } : result;
}

/** Audio → chữ: stt-local trước; cloud chỉ khi local lỗi, phụ huynh cho phép và có key OpenRouter. */
export async function transcribe(input: TranscribeInput): Promise<TranscribeResult> {
  if (input.audio.byteLength === 0 || input.audio.byteLength > sttConfig().max_bytes) throw new UnsupportedAudioError();
  if (!baseAudioMime(input.mimeType)) throw new UnsupportedAudioError();
  const format = detectAudioFormat(input.audio);
  if (!format) throw new UnsupportedAudioError();
  try {
    return styled({ ...(await transcribeLocal(input.audio, format, input.language)), source: 'local' }, input.language);
  } catch (err) {
    if (!(err instanceof LocalSttError)) throw err;
    if (err.cloudEligible) {
      // Máy ở nhà không nhận giọng: phụ huynh/admin cần biết (một cảnh báo mỗi ngày).
      await raiseSystemAlert({
        type: 'stt_local_unavailable',
        severity: 'warning',
        detail: { reason: err.message.slice(0, 300) },
        // Một cảnh báo mỗi ngày theo giờ Việt Nam (toISOString đổi ngày lúc 07:00).
        dedupeKey: `stt-local:${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
      }).catch((alertErr: unknown) => console.error('[stt] không ghi được system_alert', alertErr));
    }
    if (!err.cloudEligible || !input.cloudFallbackAllowed || !openRouterAudioConfigured()) {
      throw new SttUnavailableError([`local: ${err.message}`]);
    }
    return styled({ ...(await transcribeCloud(input, format)), source: 'cloud' }, input.language);
  }
}

/**
 * Luồng của route /api/stt: phiên phải là phiên đang mở của chính học sinh (DAL kiểm quyền), quyền
 * dùng cloud lấy từ cài đặt phụ huynh — client không tự bật được.
 */
export async function transcribeStudentAudio(
  actor: Actor,
  input: { studentId: string; sessionId: string; audio: Uint8Array; mimeType: string; language: SttLanguage },
): Promise<TranscribeResult & { receipt: string }> {
  const session = await getLearningSession(actor, { studentId: input.studentId, sessionId: input.sessionId });
  if (session.ended_at) throw new VoiceSessionClosedError();
  const prefs = await getStudentVoicePrefs(actor, input.studentId);
  const result = await transcribe({ ...input, cloudFallbackAllowed: prefs.sttCloudFallback });
  const text = normalizeTranscript(result.text);
  // Biên nhận cho đúng chữ trả về: tin gửi sau đó chỉ lưu raw_stt từ chữ có biên nhận (stt-receipt.ts).
  return { ...result, text, receipt: signSttReceipt({ studentId: input.studentId, sessionId: input.sessionId, text }) };
}
