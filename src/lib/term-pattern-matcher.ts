// Khớp thuật ngữ bị cấm/được dùng trong văn bản tiếng Việt (SPEC §5c.1, docs/CURRICULUM.md §6.1).
// Dùng cả ở server (kiểm tin nhắn của Cú, phase 12) lẫn client nên không import gì từ src/server.
//
// - Văn bản chuẩn hoá: Unicode NFC, chữ thường, gộp khoảng trắng.
// - Pattern mặc định là cụm từ thường, khớp NGUYÊN TỪ bằng ranh giới Unicode
//   (?<![\p{L}\p{M}\p{N}])…(?![\p{L}\p{M}\p{N}]) với cờ `u` — không dùng \b (không hiểu chữ có dấu).
//   Ranh giới chỉ áp ở đầu/cuối là chữ hoặc số, nên ký hiệu như "%" vẫn khớp trong "50%".
// - Tiền tố `re:` để viết regex (đã chuẩn hoá thường); regex hỏng → lỗi khi biên dịch (seed từ chối).

export function normalizeForMatching(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class InvalidTermPatternError extends Error {
  constructor(readonly pattern: string, reason: string) {
    super(`Pattern không hợp lệ "${pattern}": ${reason}`);
    this.name = 'InvalidTermPatternError';
  }
}

/** Biên dịch một pattern thành RegExp (cờ `gu`). */
export function compileTermPattern(pattern: string): RegExp {
  if (pattern.startsWith('re:')) {
    const source = pattern.slice(3);
    if (!source.trim()) throw new InvalidTermPatternError(pattern, 'regex rỗng');
    try {
      return new RegExp(source, 'gu');
    } catch (err) {
      throw new InvalidTermPatternError(pattern, err instanceof Error ? err.message : String(err));
    }
  }
  const phrase = normalizeForMatching(pattern);
  if (!phrase) throw new InvalidTermPatternError(pattern, 'cụm từ rỗng');
  const body = phrase.split(' ').map(escapeRegex).join('\\s+');
  const first = phrase[0]!;
  const last = phrase.at(-1)!;
  return new RegExp(`${WORD_CHAR.test(first) ? BEFORE : ''}${body}${WORD_CHAR.test(last) ? AFTER : ''}`, 'gu');
}

export interface TermDefinition {
  term: string;
  patterns: string[];
}

export interface TermMatch {
  term: string;
  pattern: string;
  matched: string;
  index: number;
}

export interface CompiledTermSet {
  match(text: string): TermMatch[];
}

/** Biên dịch một lần, dùng nhiều lần (snapshot phạm vi cố định trong phiên). */
export function compileTermSet(terms: TermDefinition[]): CompiledTermSet {
  const compiled = terms.flatMap((t) => t.patterns.map((p) => ({ term: t.term, pattern: p, re: compileTermPattern(p) })));
  return {
    match(text: string): TermMatch[] {
      const normalized = normalizeForMatching(text);
      const found: TermMatch[] = [];
      for (const c of compiled) {
        c.re.lastIndex = 0;
        for (const m of normalized.matchAll(c.re)) {
          found.push({ term: c.term, pattern: c.pattern, matched: m[0], index: m.index ?? 0 });
        }
      }
      return found.sort((a, b) => a.index - b.index);
    },
  };
}

export function findTermMatches(text: string, terms: TermDefinition[]): TermMatch[] {
  return compileTermSet(terms).match(text);
}
