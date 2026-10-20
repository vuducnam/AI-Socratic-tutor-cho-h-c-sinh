import 'server-only';
import type { ChatMessage } from '@/server/llm/llm-types';

// Dựng danh sách messages gửi Tutor từ lịch sử phiên. Claude API mới không nhận prefill: hội thoại phải
// mở và kết thúc bằng tin của user. Lượt mở bài chỉ có câu hook của Cú (assistant) nên cần thêm một dòng
// [Hệ thống] để Tutor viết tin kế tiếp, không viết nối vào câu hook.

const START = '[Hệ thống] Bắt đầu bài.';
const CONTINUE = '[Hệ thống] Viết tin nhắn tiếp theo của Cú.';

export function tutorConversationMessages(history: ChatMessage[], feedback: string | null): ChatMessage[] {
  const messages: ChatMessage[] = [...history];
  if (feedback) messages.push({ role: 'user', content: `[Hệ thống] Tin nhắn trước của Cú bị chặn: ${feedback}. Viết lại tin nhắn khác, đúng quy tắc.` });
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: START });
  if (messages.at(-1)?.role !== 'user') messages.push({ role: 'user', content: CONTINUE });
  return messages;
}
