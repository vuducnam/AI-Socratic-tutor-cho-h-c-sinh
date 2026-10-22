import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Biên nhận STT: /api/stt ký HMAC cho đúng đoạn chữ máy vừa nghe (gắn với học sinh và phiên). Khi gửi tin,
// client gửi lại các đoạn kèm biên nhận; server chỉ ghép `raw_stt` từ đoạn có chữ ký hợp lệ. Nhờ vậy cột
// "chữ máy nghe được" mà bố mẹ xem (quy tắc cứng 2) luôn là chữ do server nhận dạng, không phải chữ client tự khai.

export interface SttPiece {
  text: string;
  receipt: string;
}

/** Một tin tối đa 20 lần bấm micro; nhiều hơn coi như không hợp lệ. */
export const MAX_STT_PIECES = 20;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error('SESSION_SECRET chưa đặt');
  return value;
}

function mac(studentId: string, sessionId: string, text: string): Buffer {
  return createHmac('sha256', secret()).update(`stt-receipt:v1\n${studentId}\n${sessionId}\n${text}`).digest();
}

/** Chữ STT gửi cho con: gộp khoảng trắng để chữ client nhận và chữ được ký trùng nhau từng ký tự. */
export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function signSttReceipt(input: { studentId: string; sessionId: string; text: string }): string {
  return mac(input.studentId, input.sessionId, input.text).toString('base64url');
}

function validPiece(studentId: string, sessionId: string, piece: SttPiece): boolean {
  const given = Buffer.from(piece.receipt, 'base64url');
  const expected = mac(studentId, sessionId, piece.text);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * `raw_stt` của một tin: các đoạn đã ký, nối bằng khoảng trắng như ô nhập của client. Không có đoạn nào,
 * quá nhiều đoạn hoặc có đoạn sai chữ ký → null (tin vẫn gửi được, chỉ không có bản máy nghe).
 */
export function rawSttFromPieces(input: {
  studentId: string;
  sessionId: string;
  pieces: readonly SttPiece[] | null | undefined;
  maxChars: number;
}): string | null {
  const pieces = input.pieces ?? [];
  if (pieces.length === 0 || pieces.length > MAX_STT_PIECES) return null;
  if (!pieces.every((p) => validPiece(input.studentId, input.sessionId, p))) return null;
  const joined = pieces.map((p) => p.text).join(' ').trim();
  return joined ? joined.slice(0, input.maxChars) : null;
}
