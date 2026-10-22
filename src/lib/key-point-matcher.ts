// So câu trả lời của con với "cụm từ chấp nhận" của từng ý chính (SPEC §5d, quy tắc cứng 7: code quyết định con đã
// nêu ý nào, LLM không chấm). Dùng cả để chặn tin nhắn của Mít nói ra ý con chưa tự nêu (kiểm tra cứng LEAK).
//
// Chuẩn hoá: NFC, chữ thường, gạch nối/dấu câu → khoảng trắng, gộp khoảng trắng. Khớp NGUYÊN CỤM theo ranh giới
// chữ/số Unicode (không dùng \b vì không hiểu chữ có dấu). Thử thêm dạng "gập dấu thanh": bỏ dấu thanh (huyền, sắc,
// ngã, hỏi, nặng) nhưng giữ dấu chữ (ă â ê ô ơ ư đ) và coi y như i, để "thuỷ"/"thủy", "kỉ"/"kỷ", "mĩ"/"mỹ" và
// lời con gõ thiếu dấu thanh vẫn khớp. Không bỏ hẳn dấu chữ (tránh "ma"/"mà"/"mã" lẫn với "mâ"...).

const TONE_MARKS = /[̣̀́̃̉]/g;
const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

export function foldTones(normalized: string): string {
  return normalized.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC').replace(/y/g, 'i');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return new RegExp(`${BOUNDARY_BEFORE}${escape(phrase)}${BOUNDARY_AFTER}`, 'u').test(haystack);
}

export interface MatchableFact {
  fact_id: string;
  accept: string[];
}

/** Cụm chấp nhận đầu tiên của ý chính xuất hiện trong văn bản (hoặc null). */
export function matchedPhrase(text: string, fact: MatchableFact): string | null {
  const exact = normalizeForMatch(text);
  const folded = foldTones(exact);
  for (const raw of fact.accept) {
    const phrase = normalizeForMatch(raw);
    if (containsPhrase(exact, phrase) || containsPhrase(folded, foldTones(phrase))) return raw;
  }
  return null;
}

/** Các ý chính mà văn bản đã nêu (theo thứ tự của `facts`). */
export function matchedFactIds(text: string, facts: MatchableFact[]): string[] {
  return facts.filter((f) => matchedPhrase(text, f) !== null).map((f) => f.fact_id);
}
