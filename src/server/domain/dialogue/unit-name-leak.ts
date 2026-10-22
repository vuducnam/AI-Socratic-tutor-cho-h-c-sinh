import 'server-only';
import { normalizeForMatching } from '@/lib/term-pattern-matcher';
import { toCanonical } from '@/lib/vi-math-normalizer';
import { numbersIn } from './hard-checks';

// Lộ bằng tên gọi (quy tắc cứng 1): Mít nói sẵn một lượng mới kèm tên hàng thập phân, ví dụ "mỗi phần gọi
// là một phần mười" khi đề hỏi 7/10, hoặc gán tên đơn vị "7/100 là phần trăm" khi con chưa nói tới.
// Không tính: đọc lại một số có trong đề hay con đã nói ("45/100" → "45 phần trăm", "0,7" → "7 phần mười"),
// và câu hỏi không có lượng ("7/10 là bao nhiêu phần mười?", "hàng phần mười").

const NUMBER_WORD = '(?:một|hai|ba|bốn|tư|năm|lăm|sáu|bảy|tám|chín|mười|mươi|mốt|linh|lẻ|không)';
const UNIT = '(?:mười|trăm|nghìn|ngàn)';
const B = '(?<![\\p{L}\\p{M}\\p{N}])';
const A = '(?![\\p{L}\\p{M}\\p{N}])';
/** "45 phần trăm", "một phần mười", "bốn mươi lăm phần trăm". */
const AMOUNT_WITH_UNIT = new RegExp(`${B}(?:\\d+|${NUMBER_WORD}(?:\\s+${NUMBER_WORD})*)\\s+phần\\s+${UNIT}${A}`, 'gu');
/** "7/100 là phần trăm", "gọi là phần mười" — gán tên đơn vị, trừ câu hỏi lựa chọn "là phần mười hay…". */
const NAMED_AS_UNIT = new RegExp(`${B}là\\s+phần\\s+(${UNIT})${A}(?!\\s+hay)`, 'gu');
const UNIT_WORD = new RegExp(`phần\\s+(${UNIT})${A}`, 'gu');

/** Giá trị số của token đã chuẩn hoá ("0.7", "7/10", "45%") — để "45 phần trăm" khớp với "45/100" của đề. */
function valueOf(token: string): number | null {
  const t = token.replace(/\s+/g, '').replace(',', '.');
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

const key = (v: number) => v.toFixed(9);

/** "chữ số 4 đứng ngay sau dấu phẩy nên là hàng phần mười" — con đã nói 4 phần mười theo cách khác. */
const DIGIT_AT_PLACE = new RegExp(`${B}(?:chữ\\s+)?số\\s+(\\d)${A}[^.?!]{0,40}?hàng\\s+phần\\s+(${UNIT})${A}`, 'gu');
const PLACE_VALUE: Record<string, number> = { mười: 10, trăm: 100, nghìn: 1000, ngàn: 1000 };

function valuesIn(text: string): number[] {
  const lower = normalizeForMatching(text);
  const amounts = [...lower.matchAll(AMOUNT_WITH_UNIT)].map((m) => valueOf(toCanonical(m[0])));
  const digitPlaces = [...lower.matchAll(DIGIT_AT_PLACE)].map((m) => Number(m[1]) / PLACE_VALUE[m[2]!]!);
  return [...numbersIn(text).map(valueOf), ...amounts, ...digitPlaces].filter((v): v is number => v !== null);
}

/** Cụm Mít nói sẵn: lượng kèm tên hàng chưa có trong đề/lời con, hoặc gán tên đơn vị con chưa dùng. */
export function unitNameLeak(message: string, problemText: string, studentTexts: string[]): string[] {
  const sources = [problemText, ...studentTexts];
  const known = new Set(sources.flatMap(valuesIn).map(key));
  const usedUnits = new Set(sources.flatMap((t) => [...normalizeForMatching(t).matchAll(UNIT_WORD)].map((m) => m[1]!)));
  const lower = normalizeForMatching(message);
  const amounts = [...lower.matchAll(AMOUNT_WITH_UNIT)]
    .filter((m) => {
      const v = valueOf(toCanonical(m[0]));
      return v !== null && !known.has(key(v));
    })
    .map((m) => m[0]);
  const named = [...lower.matchAll(NAMED_AS_UNIT)].filter((m) => !usedUnits.has(m[1]!)).map((m) => m[0]);
  return [...new Set([...amounts, ...named])];
}
