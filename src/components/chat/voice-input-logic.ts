// Logic thuần cho nhập giọng nói ở /learn (không phụ thuộc React, test được trong Node).
// Quy tắc cứng 10: audio chỉ đi tới /api/stt của PC tại nhà; client không giữ lại bản ghi sau khi gửi.

export type SttLanguage = 'vi' | 'en';
export type InputModality = 'text' | 'voice';
export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';

/** Một lần bấm micro: chữ server đã nghe kèm biên nhận server ký (server tự ghép raw_stt từ các đoạn này). */
export interface SttPiece {
  text: string;
  receipt: string;
}

/** Siêu dữ liệu đi kèm tin con gửi: gõ chữ, hay nói rồi (có thể) sửa lại chữ. */
export interface SubmitMeta {
  inputModality: InputModality;
  sttPieces?: SttPiece[];
}

/**
 * Ghi tối đa 58 giây mỗi lần: stt-local nhận tới 60 giây (+1 giây dung sai), chừa khoảng cho độ trễ khi
 * MediaRecorder dừng và phần đuôi container. Ngắn hơn nửa giây coi như chưa nói gì.
 */
export const RECORDING_LIMIT_MS = 58_000;
export const MIN_RECORDING_MS = 500;
/** Giới hạn chữ theo ô nhập, khớp `text` của route: tin chat 1000 ký tự (/api/chat), đề bài 2000 (/api/learn/problem). */
export const TRANSCRIPT_LIMITS = { chat: 1000, problem: 2000 } as const;
export type TranscriptContext = keyof typeof TRANSCRIPT_LIMITS;
/** Trần chung cho chữ STT nhận về (ô lớn nhất); mỗi ô cắt tiếp theo giới hạn của nó. */
export const MAX_TRANSCRIPT_CHARS = Math.max(TRANSCRIPT_LIMITS.chat, TRANSCRIPT_LIMITS.problem);
export const LANGUAGE_STORAGE_KEY = 'cu_stt_language_v1';

export const MESSAGES = {
  permissionDenied: 'Bạn bật micro cho trang này nhé, hoặc gõ chữ cũng được.',
  noMicrophone: 'Mít không thấy micro trên máy này, bạn gõ chữ nhé.',
  micBusy: 'Micro đang bận, bạn thử lại hoặc gõ chữ nhé.',
  micFailed: 'Mít chưa mở được micro, bạn gõ chữ nhé.',
  empty: 'Mít chưa nghe thấy gì, bạn nói lại nhé.',
  tooLarge: 'Bạn nói dài quá, bạn nói ngắn hơn hoặc gõ chữ nhé.',
  unavailable: 'Mít chưa nghe rõ, bạn gõ chữ nhé.',
  network: 'Mít chưa nghe được, bạn thử lại hoặc gõ chữ nhé.',
  unauthenticated: 'Bạn đăng nhập lại nhé.',
  review: 'Bạn xem lại chữ rồi bấm Gửi nhé.',
} as const;

export interface RecorderFormat {
  mimeType: string;
  extension: 'webm' | 'm4a';
}

// Chrome/Edge/Firefox ghi được webm/opus; Safari và iPadOS chỉ ghi được mp4 (AAC).
const RECORDER_FORMATS: readonly RecorderFormat[] = [
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
];

export function pickRecorderFormat(isTypeSupported: (mimeType: string) => boolean): RecorderFormat | null {
  for (const format of RECORDER_FORMATS) {
    try {
      if (isTypeSupported(format.mimeType)) return format;
    } catch {
      /* trình duyệt lạ ném lỗi khi hỏi định dạng: thử định dạng tiếp theo */
    }
  }
  return null;
}

/** Môi trường tối thiểu để ghi âm; tách ra để test không cần trình duyệt. */
export interface VoiceEnvironment {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  isTypeSupported: ((mimeType: string) => boolean) | null;
}

/** Không HTTPS, không MediaRecorder hoặc không ghi được định dạng nào → ẩn micro, chỉ còn gõ chữ. */
export function isVoiceCaptureSupported(env: VoiceEnvironment): boolean {
  if (!env.isSecureContext || !env.hasGetUserMedia || !env.isTypeSupported) return false;
  return pickRecorderFormat(env.isTypeSupported) !== null;
}

/** Lỗi getUserMedia → câu nói với con (không bao giờ hiện lỗi kỹ thuật). */
export function micErrorMessage(err: unknown): string {
  // DOMException của getUserMedia mang tên lỗi chuẩn trong `name`.
  const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return MESSAGES.permissionDenied;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return MESSAGES.noMicrophone;
  if (name === 'NotReadableError' || name === 'AbortError') return MESSAGES.micBusy;
  return MESSAGES.micFailed;
}

export type SttOutcome =
  | { ok: true; text: string; receipt: string }
  | { ok: false; reason: 'unauthenticated' | 'too_large' | 'unavailable' | 'empty' | 'error'; message: string };

function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;
  const message = (body as { message: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : null;
}

/** Diễn giải phản hồi của POST /api/stt: 200 {text, receipt}, 401, 413 / 503 {error, message}. */
export function interpretSttResponse(status: number, body: unknown): SttOutcome {
  if (status === 200) {
    const fields = typeof body === 'object' && body !== null ? (body as { text?: unknown; receipt?: unknown }) : {};
    if (typeof fields.text !== 'string') return { ok: false, reason: 'error', message: MESSAGES.unavailable };
    // Server đã gộp khoảng trắng trước khi ký biên nhận; gộp lại ở đây không đổi chữ nên biên nhận vẫn khớp.
    const cleaned = fields.text.replace(/\s+/g, ' ').trim();
    const receipt = typeof fields.receipt === 'string' ? fields.receipt : '';
    return cleaned ? { ok: true, text: cleaned.slice(0, MAX_TRANSCRIPT_CHARS), receipt } : { ok: false, reason: 'empty', message: MESSAGES.empty };
  }
  if (status === 401) return { ok: false, reason: 'unauthenticated', message: MESSAGES.unauthenticated };
  // 413: quá dung lượng (route) hoặc quá số giây (stt-local) — server gửi câu nhắc riêng cho từng trường hợp.
  if (status === 413) return { ok: false, reason: 'too_large', message: serverMessage(body) ?? MESSAGES.tooLarge };
  if (status === 503) return { ok: false, reason: 'unavailable', message: serverMessage(body) ?? MESSAGES.unavailable };
  return { ok: false, reason: 'error', message: serverMessage(body) ?? MESSAGES.network };
}

/** Ghép chữ vừa nghe vào ô nhập (con có thể đã gõ hoặc nói trước đó); không vượt giới hạn của ô. */
export function mergeTranscript(current: string, addition: string, maxChars: number): string {
  const add = addition.trim();
  const base = current.trimEnd();
  const merged = !base.trim() ? add : add ? `${base} ${add}` : base;
  return merged.slice(0, maxChars);
}

/** Tin gửi đi: có đoạn nghe từ micro → voice kèm các đoạn (kể cả khi con đã sửa chữ), còn lại là text. */
export function submitMetaFor(pieces: readonly SttPiece[]): SubmitMeta {
  const heard = pieces.filter((p) => p.text.trim());
  return heard.length ? { inputModality: 'voice', sttPieces: [...heard] } : { inputModality: 'text' };
}

/** "0:42" — số giây còn lại, làm tròn lên để không hiện 0:00 khi vẫn đang ghi. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Mức âm lượng 0..1 từ dữ liệu dạng sóng 8-bit (128 = im lặng); nhân 3 cho giọng nói nhỏ vẫn thấy. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

/** Dòng trạng thái (aria-live) cho từng trạng thái ghi âm. */
export function voiceStatusText(status: RecorderStatus, message: string | null): string {
  switch (status) {
    case 'requesting':
      return 'Bạn cho phép dùng micro nhé.';
    case 'recording':
      return 'Bạn nói đi, nói xong thì bấm Dừng.';
    case 'transcribing':
      return 'Mít đang nghe…';
    case 'error':
      return message ?? MESSAGES.micFailed;
    default:
      return message ?? 'Bấm micro để nói với Mít.';
  }
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Ngôn ngữ đã chọn trên máy này; chưa chọn hoặc trình duyệt chặn lưu → mặc định của phụ huynh. */
export function readStoredLanguage(storage: KeyValueStorage | null, fallback: SttLanguage): SttLanguage {
  try {
    const value = storage?.getItem(LANGUAGE_STORAGE_KEY);
    return value === 'vi' || value === 'en' ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredLanguage(storage: KeyValueStorage | null, language: SttLanguage): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* trình duyệt chặn lưu (chế độ riêng tư): lần sau dùng lại mặc định, không sao */
  }
}

/** localStorage có thể ném SecurityError chỉ khi truy cập thuộc tính. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
