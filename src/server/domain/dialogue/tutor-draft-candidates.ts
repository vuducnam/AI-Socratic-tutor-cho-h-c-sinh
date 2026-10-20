import 'server-only';
import { splitSentences } from './hard-checks';
import type { TutorOutput } from './tutor-output-schema';

// Các bản nháp của một lần gọi Tutor, theo thứ tự thử: bản chính rồi bản ngắn dự phòng (short_message).
// Bản chính bị kiểm tra cứng chặn mà bản ngắn qua được thì dùng ngay bản ngắn, không gọi lại model
// (mỗi lần gọi lại làm con chờ thêm ~3,5 giây).
// Code gộp câu cảm thán ngắn đứng đầu vào câu sau khi tin thừa câu: "Đúng rồi! Bạn tự nối..." →
// "Đúng rồi, bạn tự nối...". Chỉ đổi dấu câu, không đổi chữ; bản đã gộp vẫn qua kiểm tra cứng và Guard.

const MAX_INTERJECTION_WORDS = 4;
// Từ mở đầu câu sau được viết thường khi gộp; tên riêng (Minh, Cú…) giữ nguyên chữ hoa.
const LOWERCASE_STARTERS = new Set(['bạn', 'mình', 'vậy', 'thế', 'giờ', 'còn', 'bây', 'thử', 'lúc', 'nếu', 'trong', 'ở', 'khi', 'theo', 'nhìn']);

export function mergeLeadingInterjection(text: string, maxSentences: number): string {
  const sentences = splitSentences(text);
  const first = sentences[0];
  if (!first || sentences.length <= maxSentences || !first.endsWith('!')) return text;
  if (first.split(/\s+/).length > MAX_INTERJECTION_WORDS) return text;
  const rest = text.slice(text.indexOf(first) + first.length).trimStart();
  const [word = '', ...tail] = rest.split(' ');
  const starter = LOWERCASE_STARTERS.has(word.toLowerCase()) ? word.charAt(0).toLowerCase() + word.slice(1) : word;
  return `${first.slice(0, -1)}, ${[starter, ...tail].join(' ')}`;
}

export function draftCandidates(output: Pick<TutorOutput, 'message' | 'short_message'>, maxSentences: number): string[] {
  const drafts = [output.message, output.short_message].filter((d): d is string => !!d?.trim()).map((d) => mergeLeadingInterjection(d.trim(), maxSentences));
  return [...new Set(drafts)];
}
