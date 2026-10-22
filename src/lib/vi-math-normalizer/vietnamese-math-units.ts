// Bảng đơn vị đo lớp 5 (độ dài, khối lượng, diện tích, thể tích, dung tích): ký hiệu ↔ cách đọc.

interface BaseUnit {
  symbol: string;
  spoken: string;
  /** Cách viết/đọc khác cũng được chấp nhận ở toCanonical (viết liền, bỏ gạch nối khi so khớp). */
  variants?: readonly string[];
  /** Có đơn vị vuông (²) / khối (³) đi kèm không. */
  square?: boolean;
  cube?: boolean;
}

const BASE_UNITS: readonly BaseUnit[] = [
  { symbol: 'mm', spoken: 'mi-li-mét', square: true, cube: true },
  { symbol: 'cm', spoken: 'xăng-ti-mét', variants: ['xen-ti-mét'], square: true, cube: true },
  { symbol: 'dm', spoken: 'đề-xi-mét', square: true, cube: true },
  { symbol: 'm', spoken: 'mét', square: true, cube: true },
  { symbol: 'dam', spoken: 'đề-ca-mét', square: true },
  { symbol: 'hm', spoken: 'héc-tô-mét', square: true },
  { symbol: 'km', spoken: 'ki-lô-mét', variants: ['kí-lô-mét'], square: true },
  { symbol: 'g', spoken: 'gam', variants: ['gram'] },
  { symbol: 'dag', spoken: 'đề-ca-gam' },
  { symbol: 'hg', spoken: 'héc-tô-gam' },
  { symbol: 'kg', spoken: 'ki-lô-gam', variants: ['kí-lô-gam', 'ki-lô-gram'] },
  { symbol: 'yến', spoken: 'yến' },
  { symbol: 'tạ', spoken: 'tạ' },
  { symbol: 'tấn', spoken: 'tấn' },
  { symbol: 'l', spoken: 'lít' },
  { symbol: 'ml', spoken: 'mi-li-lít' },
  { symbol: 'ha', spoken: 'héc-ta', variants: ['hec-ta'] },
];

/** Ký hiệu đọc được cả khi đứng một mình (không có số phía trước) mà không dễ nhầm với chữ thường. */
const STANDALONE_SYMBOLS = new Set(['mm', 'cm', 'dm', 'hm', 'km', 'kg', 'hg', 'ml']);

/** Bỏ gạch nối, khoảng trắng, viết thường: "Xăng-ti-mét vuông" → "xăngtimétvuông". */
export function compactUnitWords(text: string): string {
  return text.toLowerCase().replace(/[-\s]/g, '');
}

interface UnitEntry {
  symbol: string;
  spoken: string;
  standalone: boolean;
}

function buildUnits(): { entries: UnitEntry[]; byCompact: Map<string, string> } {
  const entries: UnitEntry[] = [];
  const byCompact = new Map<string, string>();
  const add = (symbol: string, spoken: string, names: readonly string[], standalone: boolean) => {
    entries.push({ symbol, spoken, standalone });
    for (const name of names) byCompact.set(compactUnitWords(name), symbol);
  };
  for (const unit of BASE_UNITS) {
    const names = [unit.spoken, ...(unit.variants ?? [])];
    add(unit.symbol, unit.spoken, names, STANDALONE_SYMBOLS.has(unit.symbol));
    if (unit.square) {
      add(`${unit.symbol}²`, `${unit.spoken} vuông`, names.map((n) => `${n} vuông`), true);
    }
    if (unit.cube) {
      add(`${unit.symbol}³`, `${unit.spoken} khối`, names.map((n) => `${n} khối`), true);
    }
  }
  return { entries, byCompact };
}

const { entries: UNIT_ENTRIES, byCompact: SYMBOL_BY_COMPACT } = buildUnits();

const SPOKEN_BY_SYMBOL = new Map(UNIT_ENTRIES.map((u) => [u.symbol, u.spoken]));

/** Số từ tối đa của một cách đọc đơn vị khi tách rời: "xăng ti mét vuông" = 4 từ. */
export const MAX_UNIT_WORDS = 4;

/** Tra ký hiệu từ cách đọc đã thu gọn (compactUnitWords). */
export function unitSymbolFromCompact(compact: string): string | undefined {
  return SYMBOL_BY_COMPACT.get(compact);
}

/** Cách đọc của ký hiệu: "cm²" → "xăng-ti-mét vuông". */
export function spokenUnit(symbol: string): string | undefined {
  return SPOKEN_BY_SYMBOL.get(symbol);
}

function alternation(symbols: readonly string[]): string {
  // Dài trước ngắn để "mm" không bị khớp thành "m".
  return [...symbols].sort((a, b) => b.length - a.length).join('|');
}

/** Mọi ký hiệu, dạng alternation cho RegExp (ký hiệu không chứa ký tự đặc biệt của regex). */
export const UNIT_SYMBOL_PATTERN = alternation(UNIT_ENTRIES.map((u) => u.symbol));

/** Ký hiệu được đọc cả khi không đứng sau số. */
export const STANDALONE_UNIT_SYMBOL_PATTERN = alternation(
  UNIT_ENTRIES.filter((u) => u.standalone).map((u) => u.symbol),
);

/** Ký hiệu độ dài viết kiểu bàn phím có số mũ thường: "cm2" → "cm²". */
export const POWERED_LENGTH_SYMBOL_PATTERN = alternation(
  BASE_UNITS.filter((u) => u.square).map((u) => u.symbol),
);
