import { normalizeForMatch } from './key-point-matcher';

// Môn kiến thức: "lộ" là Mít gợi BẰNG CHỮ nội dung một ý chính con chưa nói (chủ dự án duyệt 2026-10-22).
// Guard và judge (LLM) đề xuất chữ lộ bằng cách trích nguyên văn; code chỉ công nhận chữ thoả cả bốn điều:
// có trong tin của Mít, có trong câu ý chính của bài, không có trong đề, con chưa nói. Lời trích không còn chữ nào
// thoả thì không phải lộ "bằng chữ" (ví dụ câu chỉ hỏi loại điều cần tìm: "đã chuẩn bị gì?", "làm bằng gì?").
// So theo từng chữ (âm tiết) đã chuẩn hoá, GIỮ dấu thanh (bỏ dấu thì "thường" thành "thương", "tiến" thành "tiên"…
// sai nghĩa); chỉ thống nhất vị trí dấu kiểu cũ/kiểu mới ("thuỷ"/"thủy", "hoà"/"hòa"). Bỏ hư từ (chữ nối, đại từ,
// từ hỏi) và danh từ chung vì chúng có trong mọi câu và không mang nội dung.

// Dấu thanh kiểu cũ đặt trên nguyên âm cuối của vần mở (hoà, thuỷ) → kiểu mới (hòa, thủy).
const OLD_TO_NEW: Record<string, string> = {
  oà: 'òa', oá: 'óa', oả: 'ỏa', oã: 'õa', oạ: 'ọa', oè: 'òe', oé: 'óe', oẻ: 'ỏe', oẽ: 'õe', oẹ: 'ọe',
  uỳ: 'ùy', uý: 'úy', uỷ: 'ủy', uỹ: 'ũy', uỵ: 'ụy',
};
const OLD_PLACEMENT = new RegExp(`(${Object.keys(OLD_TO_NEW).join('|')})$`, 'u');
const canonicalWord = (word: string): string => word.replace(OLD_PLACEMENT, (m) => OLD_TO_NEW[m] ?? m);
const words = (text: string): Set<string> => new Set(normalizeForMatch(text).split(' ').filter(Boolean).map(canonicalWord));

const FUNCTION_WORDS = words(
  [
    'và là của có được cho những các một thì mà này đó ấy kia rồi nào gì không chưa đã đang sẽ với ở trong từ đến tới',
    'khi lúc để vì nên như cũng lại còn thế sao bạn mít em mình ta họ ai đâu bao nhiêu mấy hay hoặc nhé nhỉ ạ à ơi',
    'vậy thôi đi ra vào lên xuống theo về sau trước nhiều rất đều vẫn bị do bởi người năm ngày tháng giờ',
    // Động từ, danh từ chung Mít dùng khi hỏi hoặc chỉ sách.
    'làm bằng nhờ gọi thấy nghĩ nhớ biết kể hỏi nói xem tìm đọc ghi sách trang hình mục đoạn bài cô bố mẹ',
    // Danh từ chung có trong rất nhiều câu ý chính lịch sử, địa lí (nước ta, quân ta, giặc), không tự mang nội dung.
    'nước quân giặc địch dân',
  ].join(' '),
);

export function groundedLeakWords(input: { quotes: string[]; message: string; statements: string[]; said: string[]; problemText: string }): string[] {
  const inMessage = words(input.message);
  const inFacts = words(input.statements.join(' '));
  const known = words([input.problemText, ...input.said].join(' '));
  const grounded = new Set<string>();
  for (const quote of input.quotes) {
    for (const w of words(quote)) {
      if (!FUNCTION_WORDS.has(w) && inMessage.has(w) && inFacts.has(w) && !known.has(w)) grounded.add(w);
    }
  }
  return [...grounded];
}
