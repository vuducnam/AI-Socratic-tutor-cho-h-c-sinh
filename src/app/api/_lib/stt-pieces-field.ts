import { z } from 'zod';
import { MAX_STT_PIECES } from '@/server/voice/stt-receipt';

// Tin nói gửi kèm các đoạn STT con đã nghe (mỗi lần bấm micro một đoạn) cùng biên nhận server đã ký.
// Server tự ghép raw_stt từ đoạn hợp lệ (rawSttFromPieces), không nhận raw_stt do client khai.
export const sttPiecesField = z
  .array(z.object({ text: z.string().max(2000), receipt: z.string().max(100) }))
  .max(MAX_STT_PIECES)
  .optional();
