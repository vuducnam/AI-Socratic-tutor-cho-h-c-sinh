import 'server-only';
import type { ChatMessage } from '@/server/llm/llm-types';

// Dựng danh sách messages gửi Tutor từ lịch sử phiên. Claude API mới không nhận prefill: hội thoại phải
// mở và kết thúc bằng tin của user. Lượt mở bài chỉ có câu hook của Cú (assistant) nên cần thêm một dòng
// [Hệ thống] để Tutor viết tin kế tiếp, không viết nối vào câu hook.
// Khi tin trước bị chặn, gửi kèm bản nháp bị chặn để Tutor sửa đúng bản đó (ví dụ rút gọn khi quá dài),
// thay vì viết lại từ đầu và lặp lại lỗi. Bản nháp chưa tới con nên chỉ nằm trong lượt gọi này.

const START = '[Hệ thống] Bắt đầu bài.';
const CONTINUE = '[Hệ thống] Viết tin nhắn tiếp theo của Mít.';

export interface BlockedDraft {
  message: string;
  feedback: string;
}

export function tutorConversationMessages(history: ChatMessage[], blocked: BlockedDraft | null): ChatMessage[] {
  const messages: ChatMessage[] = [...history];
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: START });
  if (blocked) {
    if (messages.at(-1)?.role !== 'user') messages.push({ role: 'user', content: CONTINUE });
    messages.push({ role: 'assistant', content: `[Bản nháp bị chặn, con chưa thấy] ${blocked.message}` });
    messages.push({ role: 'user', content: `[Hệ thống] Bản nháp trên bị chặn: ${blocked.feedback}. Sửa bản nháp cho đúng quy tắc, giữ ý chính nếu ý đó không vi phạm.` });
  }
  if (messages.at(-1)?.role !== 'user') messages.push({ role: 'user', content: CONTINUE });
  return messages;
}
