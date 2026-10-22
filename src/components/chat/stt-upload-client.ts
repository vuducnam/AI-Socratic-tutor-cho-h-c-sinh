'use client';

import { interpretSttResponse, MESSAGES, type SttLanguage, type SttOutcome } from './voice-input-logic';

// Gửi một bản ghi lên POST /api/stt (máy chủ tại nhà) và trả về chữ. Không giữ bản ghi: sau khi hàm trả về,
// không còn tham chiếu nào tới Blob hay FormData. Lỗi mạng → câu thân thiện; huỷ (rời trang) → null.

export async function uploadForTranscript(input: {
  audio: Blob;
  extension: string;
  language: SttLanguage;
  sessionId: string;
  signal: AbortSignal;
}): Promise<SttOutcome | null> {
  try {
    const form = new FormData();
    form.set('audio', input.audio, `voice.${input.extension}`);
    form.set('language', input.language);
    form.set('sessionId', input.sessionId);
    const res = await fetch('/api/stt', { method: 'POST', body: form, signal: input.signal });
    return interpretSttResponse(res.status, await res.json().catch(() => null));
  } catch {
    return input.signal.aborted ? null : { ok: false, reason: 'error', message: MESSAGES.network };
  }
}
