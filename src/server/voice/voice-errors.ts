import 'server-only';

// Lỗi nghiệp vụ của voice. Route đổi thành mã HTTP và câu thân thiện cho con (không lộ lỗi kỹ thuật).

/** STT local lỗi và không được (hoặc không thể) dùng cloud → route trả 503, con gõ chữ. */
export class SttUnavailableError extends Error {
  readonly friendlyMessage = 'Mít chưa nghe rõ, bạn gõ chữ nhé.';
  constructor(readonly causes: string[]) {
    super(`STT không khả dụng: ${causes.join(' | ')}`);
    this.name = 'SttUnavailableError';
  }
}

/** stt-local từ chối vì đoạn ghi âm quá số giây / dung lượng (HTTP 413) → route trả 413, con nói ngắn hơn. */
export class SttAudioTooLongError extends Error {
  readonly friendlyMessage = 'Bạn nói dài quá, bạn nói ngắn hơn hoặc chia làm hai lần nhé.';
  constructor() {
    super('stt-local: đoạn ghi âm quá dài');
    this.name = 'SttAudioTooLongError';
  }
}

/** File audio không phải định dạng được nhận (theo magic bytes) hoặc rỗng → route trả 400. */
export class UnsupportedAudioError extends Error {
  constructor(message = 'Đoạn ghi âm chưa đúng định dạng.') {
    super(message);
    this.name = 'UnsupportedAudioError';
  }
}

/** Phiên học đã đóng: không nhận giọng nói cho phiên này nữa → route trả 409. */
export class VoiceSessionClosedError extends Error {
  constructor() {
    super('Phiên học đã kết thúc');
    this.name = 'VoiceSessionClosedError';
  }
}

/** Lượt không phải lời của Mít (lượt của con) → route trả 404 như lượt không tồn tại. */
export class TtsTurnNotFoundError extends Error {
  constructor() {
    super('Không có lượt của Mít để đọc');
    this.name = 'TtsTurnNotFoundError';
  }
}

/** TTS lỗi (OpenRouter, mạng, cấu hình) → route trả 503. */
export class TtsUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`TTS không khả dụng: ${reason}`);
    this.name = 'TtsUnavailableError';
  }
}
